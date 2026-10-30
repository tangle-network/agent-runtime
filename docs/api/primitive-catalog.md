<!--
  GENERATED — do not edit. Run `pnpm run docs:api` to regenerate.
  Source: scripts/gen-primitive-catalog.mjs reads the LIVE exports of this
  package + the @tangle-network/agent-eval substrate via the TypeScript compiler.
  A live export missing here = a RED BUILD (scripts/check-docs-freshness.mjs).
-->

# Primitive catalog — the never-stale anti-reinvention inventory

> **GENERATED** from `@tangle-network/agent-runtime@3.0.9` and `@tangle-network/agent-eval@1.0.0` by `scripts/gen-primitive-catalog.mjs`. Do NOT hand-edit — run `pnpm run docs:api`. This is the mechanical companion to the JUDGMENT in `canonical-api.md` (§2 decision table + §1.5 AgentProfile law): that doc says WHICH primitive to reach for and what NOT to build; this catalog proves WHAT exists. Per-symbol signatures + `file:line` live in the per-module pages under `docs/api/`.

## 1. agent-runtime — own public surface

Every subpath this package declares in `package.json` `exports`. Reach for these before hand-rolling a loop, driver, conversation runner, optimizer wrapper, or observability shim.

### Root — task lifecycle, conversation, RSI verbs, observability

Import from `@tangle-network/agent-runtime` — 235 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `agenticGenerator` | function | Full-agentic `CandidateGenerator`: run an exact profiled author inside the existing candidate worktree. |
| `auditLoopRunner` | function | `audit` mode — analyst loop over captured trace/run data. |
| `buildKnowledgeImprovementExperimentBundles` | function | Attach both frozen knowledge inputs to one otherwise-identical bundle pair. |
| `buildLoopOtelSpans` | function | Build a nested, real-duration OTLP span tree for ONE loop run from its full |
| `cleanModelId` | function | Trim a candidate model id; `undefined` for non-strings and blanks. |
| `commandVerifier` | function | A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other |
| `composeRuntimeHooks` | function | Merge several {@link RuntimeHooks} into one. Falsy entries are dropped (so you can |
| `createCommandProfileTrainer` | function | Execute one pinned command without a shell, in the runtime-owned job directory. POSIX only. |
| `createConversationBackend` | function | Adapt a multi-participant conversation into the standard execution backend contract. |
| `createIterableBackend` | function | Wrap any custom async-iterable stream into a typed `AgentExecutionBackend`. |
| `createKnowledgeImprovementActivationExecutor` | function | Apply or restore one local knowledge candidate through the shared activation contract. |
| `createOtelExporter` | function | Create an OTLP/HTTP exporter. Returns undefined when no endpoint is configured. |
| `createProfileExecutionBackend` | function | Bind one exact profile and Runtime executor to the stable `AgentExecutionBackend` contract used |
| `createProfileImprovementHarness` | function | Bind one exact profile and executor into a repeatable self-improvement |
| `createRuntimeEventCollector` | function | Build an in-memory collector that sanitizes and accumulates `AgentRuntimeEvent`s for inspection. |
| `createRuntimeStreamEventCollector` | function | Streaming-event counterpart of `createRuntimeEventCollector`. Pass each |
| `createSandboxPromptBackend` | function | Build an `AgentExecutionBackend` backed by a sandbox/sidecar `streamPrompt` call. |
| `decideKnowledgeReadiness` | function | Map a `KnowledgeReadinessReport` to a three-state branch (`ready` / `blocked` / `caveat`) the runtime, route handlers, and UI shells all switch on. |
| `decideSearchImprovement` | function | Decide a closed search from its directory, under the current ship rule, with |
| `dedicatedLane` | function | Cells that each run in their own environment, `capacity` at once. The lane cannot bound a |
| `defineRuntimeHooks` | function | Identity helper that types a {@link RuntimeHooks} literal so the fields are inferred. |
| `getModels` | function | Fetch the model catalog from the router's `/v1/models`. Throws on a non-2xx |
| `improve` | function | Train and serve a checkpoint without implying that it improved held-out quality. |
| `loopEventToOtelSpan` | function | Convert a LoopTraceEvent into an OtelSpan for export. |
| `officialGepa` | function | Build a complete method backed by GEPA's official Optimize Anything API. |
| `officialSkillOpt` | function | Build a complete method backed by Microsoft's official SkillOpt trainer. |
| `padSpanId` | function | The span-id counterpart of {@link toW3CTraceId}: 16 hex characters, same three rules. |
| `padTraceId` | function | THE rule for putting an id on the wire as a trace id. Every producer calls |
| `priceTokens` | function | What the Router would charge for this work at the model's base rates, or undefined when it |
| `readinessServerSentEvent` | function | Serialize a `KnowledgeReadinessReport` as a Server-Sent Event string. |
| `reflectiveGenerator` | function | Cheap no-sandbox `CandidateGenerator` (the `shots=1` setting): draft surface edits via the improvement adapter and apply them as one coherent candidate. |
| `reflectiveProfileProposer` | function | Build the maintained reflective proposer for a profile text surface. |
| `resolveChatModel` | function | Resolve a chat model by precedence: the first candidate carrying a |
| `resolveRouterBaseUrl` | function | Resolve the router base URL from env, normalised — no trailing `/v1` or `/`. |
| `routerLane` | function | Cells whose model calls are priced router calls, `capacity` at once. Every paid call of a |
| `runAgentTask` | function | Single-shot task lifecycle for adapter-driven tasks: readiness-gated, emits the runtime lifecycle event vocabulary, session-store pluggable. |
| `runAgentTaskStream` | function | Streaming task lifecycle: delegates execution to an `AgentExecutionBackend` (model API, sandbox, or custom iterable) and yields lifecycle events as they happen. |
| `runConversation` | function | Run a conversation to completion and return its terminal result. |
| `runConversationStream` | function | Streaming conversation orchestrator: drives N participants in turn through their own backends, enforcing `maxTurns` / `maxCreditsCents` / `haltOn`, yielding per-event stream markers. |
| `runKnowledgeImprovementJob` | function | Produce a frozen KB candidate while leaving live knowledge content unchanged. |
| `runPersonaConversation` | function | Run one worker profile against one persona as a multi-round conversation. |
| `runPersonaDispatch` | function | Wrap {@link runPersonaConversation} as a `ProfileDispatchFn` for |
| `runtimeStreamServerSentEvent` | function | Serialize a `RuntimeStreamEvent` as a Server-Sent Event string. |
| `sanitizeKnowledgeReadinessReport` | function | Strip PII and large blobs from a `KnowledgeReadinessReport` for safe telemetry emission. |
| `searchMethod` | function | Build Runtime's native search for `improve(profile, { method })`. |
| `sharedBoxLane` | function | Cells as workers packed into shared Sandbox boxes, `workersPerBox` to a box. |
| `startRuntimeRun` | function | Construct a runtime-run handle. The returned handle is mutable across its |
| `subscriptionLane` | function | Cells on subscription seats, one cell a seat. A seat charges no dollar per call, so its own |
| `validateChatModelId` | function | Validate a caller-supplied chat-model id. Rejects non-strings, malformed |
| `DEFAULT_ROUTER_BASE_URL` | const | Default Tangle Router base URL used when no env override is set. |
| `isolatedCheckBoxEvidenceSchema` | const | Decode the existing execution contract without widening or reinterpreting its evidence. |
| `isolatedCheckResultSchema` | const | Execution evidence, not a verdict about task correctness or permission to execute again. |
| `optimizerMethod` | const | The shared method block every build/author prompt embeds. Domain framing |
| `ROUTER_PRICE_SOURCE` | const | The Router catalog file and commit these prices were copied from. |
| `AgentEvalError` | class | Base class for every contract error this package throws — carries the stable |
| `BackendTransportError` | class | A backend transport call (HTTP, gRPC, sidecar IPC) failed with a non-success |
| `ConfigError` | class | Configuration missing or malformed (`HOME` unset, required image not supplied, env var absent). |
| `InMemoryRuntimeSessionStore` | class | In-memory `RuntimeSessionStore` for single-process use and tests. |
| `JudgeError` | class | A judge call failed in a way that's not retryable: schema parse failure, bad rubric, conflicting dimensions. |
| `NotFoundError` | class | A named resource (run, span, rubric, scenario, dataset row, route) does not exist. |
| `SearchEnvironmentFault` | class | The environment, not the candidate, ended the attempt: a box that died, a platform that |
| `ValidationError` | class | Caller passed invalid arguments (out of range, mutually-exclusive options, bad shape). |
| `CandidateGenerator` | interface | The byte-producing path that differs between the cheap |
| `CircuitBreakerConfig` | interface | Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`. |
| `ImproveCandidateValidationInput` | interface | Exact materialized profile presented for validation before any candidate run. |
| `ImproveCost` | interface | Normalized spend reported for one Runtime improvement run. |
| `ImproveLineage` | interface | Optimizer ancestry sealed into downstream candidate experiments. |
| `ImproveMethodLineage` | interface | Method optimization always retains every identity needed to reject task reuse. |
| `ImproveProfileComponents` | interface | Caller-owned mapping for optimizing several profile fields as one candidate. |
| `ImproveScenarioPartitions` | interface | Redacted task evidence retained for every optimizer-visible partition. |
| `ImproveSearchIdentity` | interface | What a search ledger records about an improvement and cannot infer: what is |
| `ImproveSearchMethod` | interface | Runtime's native search: a policy, an allocator and a proposer on Eval's |
| `ModelInfo` | interface | A model entry as returned by the Tangle Router `/v1/models` endpoint. |
| `OfficialOptimizerContextOptions` | interface | Runtime context appended to an official optimizer's own configuration. |
| `OpenAIChatTool` | interface | OpenAI Chat Completions tool descriptor. The shape mirrors the |
| `OtelExportStats` | interface | Delivery accounting for one exporter. `written + dropped + pending` covers every span handed to |
| `ProfileImprovementHarness` | interface | A small, reusable front door over `improve(profile, options)`. |
| `ProfileTrainer` | interface | Managed adapters use this same port: cancel the job on abort and download one exact checkpoint file. |
| `ReflectiveProposerParent` | interface | One parent, as `evidence` receives it. |
| `RouterEnv` | interface | Env keys the router base URL is resolved from. |
| `RunRecord` | interface | Mandatory paper-grade fields for a single evaluation run. Optional |
| `RuntimeHooks` | interface | The observation seam attached to a running loop (never to the portable genome). |
| `SearchCellContext` | interface | What the agent of one attempt knows about where and as what it runs. |
| `SearchLane` | interface | An execution lane: slots that share one cost rule, and the profiles they cannot run. |
| `SearchLaneOptions` | interface | Options every lane builder takes. |
| `SearchPromotion` | interface | A search's claim as a `SuperviseRegistry.profiles` promotion: list it beside the |
| `SharedBoxSearchLane` | interface | A lane of workers packed into shared Sandbox boxes. Close `placement` when the run settles. |
| `VerifyResult` | interface | Outcome of verifying a candidate worktree. |
| `AgentEvalErrorCode` | type | Error taxonomy for `@tangle-network/agent-eval`. |
| `AgenticGeneratorShotDisposition` | type | Worktree decision emitted before a completed shot is retried, accepted, or |
| `AgenticGeneratorShotExecution` | type | Runtime's exact terminal turn plus its complete normalized event stream. |
| `AgentImprovementActivationReconciliation` | type | Target-read-only check for a prior exact write. |
| `AgentImprovementActivationTransition` | type | Product-owned or Runtime-composed transition. |
| `ImproveCandidateValidator` | type | Accept by returning void synchronously; reject by throwing. Async callbacks are refused. |
| `ImproveCodeRunOptions` | type | Runtime-owned code search in isolated git worktrees. |
| `ImproveMethodFactory` | type | Build a complete method after trace findings are available. |
| `ImproveMethodOptions` | type | Complete-method configuration for every non-code profile surface. |
| `ImproveProfileAgent` | type | Runs one exact materialized profile on one scenario. |
| `ImproveSearchAgent` | type | The agent of a native search: the exact node profile on one scenario. |
| `ImproveSearchOptions` | type | Improve a profile with `searchMethod`. The search runs on all three splits: |
| `ImproveSurface` | type | The executable agent lever `improve` optimizes — every surface a proposal can name |
| `OfficialGepaOptions` | type | Official GEPA configuration plus bounded Runtime findings context. |
| `OfficialSkillOptOptions` | type | Official SkillOpt configuration plus bounded Runtime findings context. |
| `OpenAIChatResponseFormat` | type | `response_format` parameter for OpenAI-compatible chat endpoints. Use |
| `OpenAIChatToolChoice` | type | `tool_choice` parameter for OpenAI-compat chat. Same shape as the OpenAI |
| `OtelSpan` | type | One OTLP/JSON span: agent-trace-contract's wire type. |
| `PersonaDriver` | type | A persona that drives the conversation: either a full driver `AgentProfile` |
| `ReadonlyAgentProfile` | type | Complete immutable profile value used during measured execution. |
| `ReflectiveProposerChat` | type | One chat completion, made by the caller's client. |
| `RetryableErrorPredicate` | type | Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors. |
| `RetryBackoff` | type | Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`. |
| `RuntimeCanonicalStreamEvent` | type | Agent Interface events that do not belong to Runtime's task vocabulary. |
| `RuntimeFailureCause` | type | A terminal failure as values, carried on final and settled events beside their existing |
| `RuntimeFailureCode` | type | Stable failure codes. A consumer branches on these, never on `cause` text. |
| `RuntimeFailureOwner` | type | Who must act before the same work can succeed. |
| `RuntimeHookPhase` | type | Runtime hook contracts. Hooks are execution-scoped observers, not part of an |
| `SearchDispatchContext` | type | A campaign dispatch context with the search attempt it runs. |
| `SearchLaneKind` | type | What a lane's slots are. |
| `SearchTraceOptions` | type | Where a search's cell spans go. Default: one OpenInference file per search when storage is |
| `Verifier` | type | Verifies the edited worktree. Sync or async; throws only on a setup fault |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentAdapter`, `AgentBackendContext`, `AgentBackendInput`, `AgentExecutionBackend`, `AgenticGeneratorOptions`, `AgenticGeneratorShotReceipt`, `AgentImprovementActivationResultStore`, `AgentKnowledgeProvider`, `AgentTaskContext`, `AgentTaskRunResult`, `AgentTaskSpec`, `BackendCallPolicy`, `ChatModelCandidate`, `CheckpointServingPort`, `ControlBudget`, `ControlEvalResult`, `ControlledTrainingCommand`, `ControlRunResult`, `ControlStep`, `Conversation`, `ConversationDriveState`, `ConversationParticipant`, `ConversationPolicy`, `ConversationResult`, `ConversationTurn`, `CreateKnowledgeImprovementActivationExecutorOptions`, `CreateProfileImprovementHarnessOptions`, `DataAcquisitionPlan`, `DecideSearchImprovementOptions`, `HaltContext`, `HaltSignal`, `ImproveCodeBaseOptions`, `ImproveCodeResult`, `ImproveCustomCodeGeneratorOptions`, `ImprovementCodeCandidate`, `ImprovementProfileCandidate`, `ImproveMethodContext`, `ImproveMethodResult`, `ImproveRuntimeCodeGeneratorOptions`, `ImproveSearchResult`, `ImproveSkillsOptions`, `ImproveTrainingOptions`, `KnowledgeImprovementActivationExecutor`, `KnowledgeImprovementCandidatePair`, `KnowledgeImprovementExperimentBundles`, `KnowledgeImprovementJobMeasurement`, `KnowledgeImprovementJobResult`, `KnowledgeReadinessCheckInput`, `KnowledgeReadinessDecision`, `KnowledgeReadinessReport`, `KnowledgeRequirement`, `OfficialSensitiveCandidateInput`, `OtelExportConfig`, `OtelExporter`, `PersonaConversationResult`, `ProfileTrainerRequest`, `ReflectiveGeneratorOptions`, `ReflectiveProfileProposerOptions`, `ReflectiveProposerReply`, `ResolvedChatModel`, `RunAgentTaskOptions`, `RunAgentTaskStreamOptions`, `RunConversationOptions`, `RunKnowledgeImprovementJobOptions`, `RunPersonaConfig`, `RunPersonaConversationOptions`, `RuntimeEventCollector`, `RuntimeHookContext`, `RuntimeHookErrorContext`, `RuntimeHookEvent`, `RuntimeRunCompleteInput`, `RuntimeRunCost`, `RuntimeRunHandle`, `RuntimeRunOptions`, `RuntimeRunPersistenceAdapter`, `RuntimeRunRow`, `RuntimeSession`, `RuntimeSessionStore`, `RuntimeStreamEventCollector`, `RuntimeStreamEventSummary`, `RuntimeTelemetryOptions`, `SanitizedKnowledgeReadinessReport`, `SanitizedKnowledgeRequirement`, `SearchImprovementDecision`, `SearchMethodOptions`, `ServerSentEventOptions`, `TokenWork`, `AgenticGeneratorExecutorForWorktree`, `AgentRuntimeEvent`, `AgentRuntimeEventSink`, `AgentTaskStatus`, `AuthSource`, `ChatModelValidation`, `ControlDecision`, `ConversationStreamEvent`, `DeepReadonly`, `DelegatedLoopRunner`, `HaltPredicate`, `HaltReason`, `ImproveCodeOptions`, `ImproveMethodSource`, `ImproveOptimizationRunOptions`, `ImproveProfileSurface`, `ImproveTrainingResult`, `KnowledgeReadinessCheck`, `KnowledgeReadinessCheckResult`, `OtelAttribute`, `ProfileImprovementHarnessRunOptions`, `ProfileImprovementHarnessTrainOptions`, `RuntimeHookTarget`, `RuntimeRunStatus`, `RuntimeStreamEvent`, `RuntimeStreamEventSink`, `TrainingBoundaryResult`, `TurnOrder`.

### Vertical agent — manifest + surface proposal source

Import from `@tangle-network/agent-runtime/agent` — 30 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `assertProfileMaterializes` | function | Throw when the CHOSEN HARNESS has no control for a dimension the profile asks for. |
| `createSandboxAct` | function | Build an `AgentRuntime.act` implementation backed by a single prod-profile |
| `createSurfaceImprovementProposer` | function | Resolve each finding to a real surface and draft a detached patch candidate. |
| `defineAgent` | function | Construct a validated agent manifest. Throws `AgentManifestError` |
| `renderSurfaceIssues` | function | Format a list of surface validation issues into a human-readable error string. |
| `unimplementedAgentRun` | function | Stub for agents whose `runtime.act` is not yet wired to the substrate's |
| `validateSurfaces` | function | Validate an `AgentSurfaces` map on disk — missing paths fail loud at `defineAgent` time instead of silently skipping self-improvement edits. |
| `AgentManifestError` | class | Thrown when `defineAgent` finds a required surface missing on disk. |
| `AgentManifest` | interface | The full agent manifest. Each agent ships ONE of these. |
| `AgentSurfaces` | interface | Surface declarations. Every path is repo-relative (or absolute) at |
| `AssertProfileMaterializationOptions` | interface | Input for throwing on dropped profile axes. |
| `DefineProfileMaterializationContractOptions` | interface | Input for declaring a run path's profile-axis support. |
| `ProfileMaterializationContract` | interface | Declares which AgentProfile axes a concrete run path really carries. |
| `ProfileMaterializationIssue` | interface | One changed AgentProfile axis that would be dropped by a run path. |
| `SandboxActComposeOverrides` | interface | Per-persona profile-merge slots applied over the base profile (§1.5: the caller authors the |
| `SurfaceValidationIssue` | interface | Validate that every declared surface exists on disk under `repoRoot`. |
| `ValidateProfileMaterializationOptions` | interface | Input for checking a candidate diff against a run path. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentRubric`, `AgentRunContext`, `AgentRunInvocation`, `AgentRuntime`, `AnalystConfig`, `CreateSandboxActOptions`, `CreateSurfaceImprovementProposerOptions`, `DraftPatchInput`, `DraftPatchOutput`, `JudgeConfig`, `ResolvedSurface`, `RubricDimension`, `SurfaceImprovementEdit`.

### Product chat turns — edge-safe streaming, persistence, and stable execution IDs

Import from `@tangle-network/agent-runtime/durable` — 96 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `acquireRunDirectoryLock` | function | Take `runDir/supervise.lock`, or refuse. |
| `assertPursuitVersions` | function | Validate a `versions` option before any compute. The same check runs inside `supervisePursuit`; |
| `deriveExecutionId` | function | Derive a stable execution id from the run identity. |
| `discoverDurableSupervisionRun` | function | Discover the stable identities recorded by Runtime's durable supervision |
| `durableRunToolSpans` | function | Every tool span a finished `supervise({ runDir })` run recorded, read from its directory alone: |
| `handleChatTurn` | function | Run one chat turn. Returns immediately with a `ReadableStream` body; |
| `observerRecordDigest` | function | Compute the canonical SHA-256 digest for an unsigned observer record. |
| `projectPursuit` | function | Fold one append-only execution journal into a deterministic operator projection. |
| `readFailureRecord` | function | Read the most recent failure record, or `undefined` when the directory holds none. |
| `readRootStream` | function | Every committed line of the root stream, in order, or `undefined` when there is no file. A |
| `readRootStreamReceipt` | function | The receipt for the root stream a run directory holds, recomputed from the file's bytes, or |
| `readRunDirectoryLock` | function | Read the holder a lock file names, or `undefined` when no lock file names one. |
| `readRunParking` | function | Read the journal's bounded parking projection. Undefined means no current parking handoff. |
| `readSettleRecord` | function | Read the settle record a run directory holds, or `undefined` when it holds none. A file that |
| `runDirectoryHolderIsLive` | function | Whether a run directory is still held by the live process that took its lock. |
| `superviseGraphPursuit` | function | Graph twin of `supervisePursuit`, using its directory lifecycle and `runGraph` execution. |
| `supervisePursuit` | function | Execute `supervise()` with a durable observer and return its verified pursuit projection. |
| `RUN_FORK_CORRELATION_KEYS` | const | The `execution.correlation` keys a fork records on its root. Runtime writes them; a caller that |
| `FileObserverJournal` | class | Durable, append-only third-person history for one concrete Runtime execution. |
| `RunDirectoryLockedError` | class | The directory is held by a live process. `holder` is what that process recorded. |
| `RunParkedError` | class | A resumable wait, with no terminal result or failure. Catch it and let the coordinator exit. |
| `SettledRunDirectoryError` | class | The directory already holds a settle record, so the run it records must not be re-entered. |
| `SupervisePursuitError` | class | A failed Runtime execution whose complete third-person projection was retained. |
| `AnalyzeOnSettleRoute` | interface | One analyst-on-settle ROUTE: which lens runs (`kind`), over WHICH settled workers (`over`), |
| `AuthorizedDownMessage` | interface | Product-authorized continuation bytes. Returning a narrowed instruction replaces the proposed |
| `AuthorizedSpawn` | interface | The product-authorized result for one complete spawn request. Attribution is never accepted |
| `AuthorizedSpawnContext` | interface | Exact trusted context after a manager-authored spawn has passed product authorization. |
| `ChatStreamEvent` | interface | The NDJSON line protocol every product chat client already speaks. |
| `ChatTurnHooks` | interface | Product callbacks invoked while one chat turn runs. |
| `ChatTurnIdentity` | interface | Identity of a chat turn. `tenantId` is the workspace id for workspace- |
| `ChatTurnProducer` | interface | The live side of a turn returned by the product's `produce` hook. |
| `ChatTurnResult` | interface | HTTP response values returned for one chat turn. |
| `CoordinationReadAccess` | interface | Runtime-only read capability delivered to an operator client, never to the canonical profile. |
| `DownMessageAuthorizationInput` | interface | Detached continuation bytes and exact worker identity presented to product authorization before |
| `DurableFailureRecord` | interface | What `failure.json` records about the most recent throw. |
| `DurableSupervisionDiscovery` | interface | Identities discoverable from one `supervise({ runDir })` directory without |
| `ManagerWakePolicy` | interface | How Runtime wakes a manager that ended its turn with work open. |
| `MapOnSettleRoute` | interface | One map-on-settle ROUTE: the coordination form of an AgentGraph `maps` edge. When a worker whose |
| `ObserverRecord` | interface | One immutable record in the observer plane. `sequence` is journal order, not |
| `ParkedRun` | interface | The current parked root, read without loading its journal. |
| `PursuitFork` | interface | Start a run as a version of a settled run: the parent's recorded root inputs plus one change. |
| `PursuitNodeCost` | interface | One node's dollar cost with the provenance that decides whether it may be compared or summed. |
| `PursuitNodePlatform` | interface | One node's PLATFORM consumption — box wall time, the resource a subscription seat really pays. |
| `PursuitNodeTiming` | interface | One node's clock. `wallMs` is `settledAt - startedAt` and is deliberately distinct from the |
| `PursuitNodeUsage` | interface | One node's token usage by class. Cache and reasoning classes are absent when the provider did |
| `PursuitObserverDelivery` | interface | Where a pursuit's observer projection is delivered while it runs, so a run started anywhere is |
| `PursuitRunProjection` | interface | One attempt at one concrete Runtime run: the stretch of `agent.run` lifecycle from a `before` |
| `PursuitRunTotals` | interface | One run's spend counted once, and each node's own share of it. `inclusive` and the entries of |
| `PursuitVersionChain` | interface | The chain as its search ledger records it, returned beside the kept version's result. |
| `PursuitVersions` | interface | Continue a pursuit across versions: after each version settles, an outside judge scores it, and |
| `PursuitVersionStop` | interface | The chain's stop rule. The chain starts no version its caps do not admit. |
| `RunChatTurnInput` | interface | Inputs for one streamed product chat turn. |
| `RunDirectoryHolderLiveness` | interface | What {@link runDirectoryHolderIsLive} proved about a run directory's recorded holder. |
| `RunDirectoryLock` | interface | A held lock. `release()` removes the file; it is safe to call more than once. |
| `RunDirectoryLockHolder` | interface | What the lock file records about its holder. |
| `RunParkingPolicy` | interface | Release a durable coordinator after it has only waited this long. The caller's keeper owns wakeup. |
| `RunParkingRecord` | interface | The durable handoff from a waiting coordinator to its existing keeper. |
| `RunReopen` | interface | `supervisePursuit`'s `reopen` option: reopen this settled run under its own run id. |
| `SettledPursuitVersion` | interface | A settled version, as the judge and `next` read it. |
| `SuperviseGraphPursuitOptions` | interface | Options for {@link superviseGraphPursuit}: every `runGraph` option, plus the pursuit identity, |
| `VersionJudge` | interface | An outside judge. Runtime calls it after a version's settle record exists, never inside the |
| `WorkerSlots` | interface | A fleet-wide bound on concurrently working agents, with a queue for the spawns past it. |
| `WorkerWatchOptions` | interface | Online-detector wiring for spawned workers (`CoordinationToolsOptions.watchWorkers`). |
| `ContinuityMode` | type | How a spawn CONTINUES a node's prior work: `'fresh'` starts a brand-new session (the default, |
| `CoordinationRejectReason` | type | Why the coordination boundary refused a request. The refusal's JSON-RPC error body names it, so |
| `DeadlineCheckIn` | type | What a steerable child's own time box does: a check-in, not a kill. At the child's deadline its |
| `DriveHarnessOwnerContext` | type | Trusted manager identity available before its external harness starts. A product uses this to |
| `EscalateQuestion` | type | Where a question leaves this manager when `ask_parent` is called. |
| `NextPursuitVersion` | type | Build the one change the next version applies to `best.profile`. Its `id` must be non-empty. |
| `PursuitCostProvenance` | type | Where a node's dollar figure came from. `reported` = a provider billed all of it; `estimated` = |
| `PursuitStatus` | type | One settled projection status, shared by runs and nodes. `down` is the journal's own word for a |
| `QuestionEscalationOutcome` | type | The result of handing a question this manager cannot answer to whatever is above it. |
| `ResolveDriveHarness` | type | Resolve an external harness for one exact Runtime-owned manager identity. |
| `RetainedPendingCause` | type | Why a retained execution has no accepted terminal result, classified where the cause is still |
| `RootStreamRecord` | type | One line of `root-stream.jsonl`. |
| `SelectSeat` | type | The caller owns account eligibility and credential resolution; Runtime owns the chain order. |
| `ToolLoopCompactionOptions` | type | Public supervisor-facing compaction config: same knobs as the primitive, but `distill` is optional |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `CoordinationAuthentication`, `CoordinationHttpAudit`, `CoordinationPublicAddress`, `CoordinationTransportOptions`, `DurableCoordinationStreamIdentity`, `JudgedPursuitVersion`, `NextPursuitVersionInput`, `ObserverJournal`, `PursuitNodeProjection`, `PursuitProjection`, `RuntimeDecisionEvidenceRef`, `RuntimeDecisionPoint`, `SeatSelectionInput`, `SupervisedPursuitResult`, `SupervisePursuitOptions`, `VersionVerdict`, `ObserverRecordKind`, `RuntimeDecisionKind`, `SeatSelection`.

### Product chat turn engine alone — the turn stream and stable execution IDs, nothing file-backed

Import from `@tangle-network/agent-runtime/chat-turn` — 8 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `deriveExecutionId` | function | Derive a stable execution id from the run identity. |
| `handleChatTurn` | function | Run one chat turn. Returns immediately with a `ReadableStream` body; |
| `ChatStreamEvent` | interface | The NDJSON line protocol every product chat client already speaks. |
| `ChatTurnHooks` | interface | Product callbacks invoked while one chat turn runs. |
| `ChatTurnIdentity` | interface | Identity of a chat turn. `tenantId` is the workspace id for workspace- |
| `ChatTurnProducer` | interface | The live side of a turn returned by the product's `produce` hook. |
| `ChatTurnResult` | interface | HTTP response values returned for one chat turn. |
| `RunChatTurnInput` | interface | Inputs for one streamed product chat turn. |

### Bounded tool calls for browser and edge runtimes

Import from `@tangle-network/agent-runtime/tool-loop` — 15 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `runToolLoop` | function | Run the bounded tool loop and return the final text + every executed tool |
| `streamToolLoop` | function | Streaming bounded tool loop: yields each raw turn event (the caller maps + |
| `ToolCallContext` | interface | What the loop hands a running tool besides its call. |
| `ToolLoopAssistantToolCall` | interface | One OpenAI-shaped tool-call entry carried on an assistant message, plus any |
| `ToolProgressUpdate` | interface | One progress report from a running tool, shaped like an MCP `notifications/progress` |
| `ToolCallExecutor` | type | Executes one tool call. Implementations that take only the call stay valid. |
| `ToolCallOutcome` | type | Outcome of one tool dispatch — structurally compatible with a hub/integration |
| `ToolLoopMessage` | type | A message in the running conversation the loop sends to `streamTurn`. |
| `ToolLoopStopReason` | type | Why the loop stopped. `completed` = model finished naturally; `stuck-loop` = |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `RunToolLoopOptions`, `StreamToolLoopOptions`, `ToolLoopCall`, `ToolLoopResult`, `StreamToolLoopYield`, `ToolLoopEvent`.

### Execution placement — cheapest tier a profile allows, edge-safe

Import from `@tangle-network/agent-runtime/placement` — 12 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `placeExecution` | function | Choose where work runs: the cheapest tier every declared requirement allows. |
| `loopTierProfileMaterialization` | const | The profile axes `inference` and `loop` carry: identity, prompt, model controls and |
| `PLACEMENT_POLICY` | const | The policy version every {@link PlacementRecord} carries. |
| `PlacementRefusedError` | class | No tier can meet every declared requirement. Raised before any spend. |
| `PlacementContext` | interface | Which tiers this deployment has wired. |
| `PlacementRecord` | interface | What was chosen, under which policy, why, and why each other tier was refused. |
| `PlacementRequirements` | interface | The declared requirements of the work, beside its profile. Field names follow |
| `AgentProfileMaterializationAxis` | type | AgentProfile axis name, with `custom:<name>` reserved for caller-owned extensions. |
| `ExecutionTier` | type | Where one unit of agent work runs, cheapest first. |
| `VacuousAxis` | type | Profile axes a tier may count as covered when their declared value grants nothing. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `PlaceExecutionInput`, `KnownAgentProfileMaterializationAxis`.

### Intelligence SDK — Observe + provable-OFF billing

Import from `@tangle-network/agent-runtime/intelligence` — 145 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `agentImprovementProfileDiffs` | function | Derive the ordered profile patch that changes one executable profile into |
| `agentImprovementProfileSurfaceDigest` | function | Return the `Sha256Digest` of one profile surface using Runtime's canonical candidate digest. |
| `agentImprovementProfileSurfaceInput` | function | Return the canonical current-state input for one profile-deliverable improvement target. |
| `agentImprovementTargetProfileDiffs` | function | Replace one measured profile surface exactly, including array-valued resources. |
| `compileEffort` | function | Compile resolved `EffortSettings` into the orchestration overrides above. Pure: same |
| `composeCertifiedPrompt` | function | Fold the certified prompt surface (and any certified prompt-folding artifacts: |
| `createAgentImprovementActivation` | function | Authorize product-owned writes only after the exact candidate was measured and approved. |
| `createAgentImprovementActivationResult` | function | Create the exact result a product stores in the same transaction as its target write. |
| `createAgentImprovementProposal` | function | Create the reviewable record only from a complete, recomputable experiment result. |
| `createCertifiedPromptSource` | function | Create the cached certified-prompt source — the ONE module-scope-cache + |
| `createExactProcessCandidateExperimentExecutor` | function | Execute one signed experiment cell through any declared exact-process provider. |
| `createIntelligenceClient` | function | Create an Observe-mode Intelligence client. Resolves effort, the base URL, and |
| `createOptimizationActivationReceipt` | function | Build a detached receipt only for methods backed by an identified external optimizer. |
| `createProtectedExactProcessCandidateExperimentExecutor` | function | Compose host-owned execution ports with protected model access for one exact-process run. |
| `defaultRedactor` | function | The built-in redactor. Cycle-safe, depth-bounded and total: it never throws |
| `executeAgentCandidateExperimentCell` | function | Execute one exact arm, task, repetition, seed, and attempt through Runtime. |
| `executeAgentImprovementActivation` | function | Validate and execute one product-owned activation transition. |
| `isAgentImprovementProfileSurface` | function | Return whether a measured surface can be delivered through an agent profile. |
| `isAgentProfileMeasuredSurface` | function | Return whether a surface is eligible for shared profile measurement. |
| `isIntelligenceOff` | function | True when these settings admit NO intelligence spawn — the passthrough |
| `manifestFromProfile` | function | Lower the EXISTING plane wire (`CertifiedProfile`) into a `CapabilityManifest`. |
| `optimizationActivationReceiptFromMetadata` | function | Read and verify the optimizer evidence carried by a measured proposal. |
| `parseCandidateProfileMaterialization` | function | Parse and check every native file hash plus both canonical document digests. |
| `prepareAgentImprovementProfileActivation` | function | Compare product-owned profiles with an exact measured transition and prepare |
| `proposeAgentImprovement` | function | Analyze, search, then remeasure the resulting exact candidate before proposing it. |
| `proposeAgentProfileImprovement` | function | Analyze a product-owned profile, search one profile surface, then run the |
| `proposeAuthoredAgentProfileImprovement` | function | Put a complete authored/imported profile through the canonical profile |
| `pullCertified` | function | Pull the certified composed profile for a target. Fail-closed: a network |
| `resolveEffort` | function | Compile a named tier (plus optional per-field overrides) into the flat |
| `reviewAgentImprovementProposal` | function | Persist a human or tenant-policy decision bound to one exact proposal. |
| `runAgentCandidateExperiment` | function | Execute both arms of one immutable experiment and derive its paired result. |
| `verifyAgentImprovementActivation` | function | Validate activation authority against the exact proposal, review, experiment, and base state. |
| `verifyAgentImprovementActivationResult` | function | Recompute one historical activation result against the exact measured proposal and authority. |
| `verifyAgentImprovementProposal` | function | Validate a proposal and recompute every binding to its measured experiment. |
| `verifyAgentImprovementReview` | function | Validate the canonical identity and wire shape of an improvement review. |
| `verifyCandidateExecutionEvidence` | function | Recheck one Runtime receipt against its exact signed experiment cell. |
| `withIntelligence` | function | Wrap an agent so it (a) RECEIVES the tenant's certified profile — the prompt |
| `AGENT_IMPROVEMENT_PROFILE_SURFACES` | const | Agent improvement surfaces delivered as exact `AgentProfileDiff` replacements. |
| `AGENT_PROFILE_MEASURED_SURFACES` | const | Profile changes eligible for the product-owned measured comparison path. |
| `exactProcessCandidateExperimentExecutionSupport` | const | Candidate surfaces implemented by the neutral exact-process executor. |
| `CapabilityNotAdmittedError` | class | A consumer rejected a binding that its executor does not admit. |
| `AgentImprovementActivation` | interface | Authority receipt permitting activation of one already-measured candidate. |
| `AgentImprovementActivationResult` | interface | Immutable outcome of one idempotent, transaction-wide activation attempt. |
| `AgentImprovementReview` | interface | Human or tenant-policy decision bound to one exact proposal. |
| `AgentProfileCandidateMeasurementExecutor` | interface | Product-owned executor for exact baseline/candidate profile measurement. |
| `AgentProfileImprovementBenchmark` | interface | Product-owned task material that Runtime freezes before either profile state runs. |
| `AgentProfileImprovementExecutor` | interface | One product execution adapter shared by optimizer search and exact profile |
| `AppliedIntelligence` | interface | What the hook hands the agent each run. Additive over the prompt-only |
| `CandidateExecutionEvidence` | interface | Complete execution of one exact experiment attempt. |
| `CapabilityManifest` | interface | The strict generalization of `CertifiedProfile`. `promptSurface` is kept |
| `CertifiedArtifact` | interface | A promoted, certified artifact (one entry in the composed profile). |
| `CertifiedCapability` | interface | One certified unit of agent power. |
| `CertifiedCapabilitySummary` | interface | The composed endpoint's per-capability summary — the narrow shape on the |
| `CertifiedProfile` | interface | The composed certified profile — exactly the shape the plane's |
| `CertifiedPromptSource` | interface | A cached, self-refreshing source of a target's certified prompt additions — |
| `CertifiedPromptSourceOptions` | interface | Options for {@link createCertifiedPromptSource} — the pull coordinates plus |
| `CertifiedPromptSurface` | interface | The active promoted prompt surface for a target. |
| `CertProvenance` | interface | The certify lane's held-out lift travelling WITH delivery. The shipped |
| `CreateProtectedExactProcessCandidateExperimentExecutorOptions` | interface | Builds the standard exact-process executor with model access that is scoped, |
| `CredentialRef` | interface | A named secret a binding requires — declared, never carried. |
| `DiffProvenance` | interface | The held-out provenance the plane's certify step stamps on a promoted diff. |
| `DoctorReport` | interface | The `doctor()` readiness report — Mode-readiness without any network call. |
| `EffortOverridesCompiled` | interface | The run-config overrides an `EffortSettings` compiles to — the bridge between the |
| `EffortSettings` | interface | The flat, resolved settings a tier compiles to. Every field is individually |
| `HostSpec` | interface | The host a `process-on-infra` binding provisions before its inner binding. |
| `IntelligenceClient` | interface | The Observe-mode Intelligence client. |
| `IntelligenceConfig` | interface | Client configuration. `project` + `apiKey` are the Observe minimum; the |
| `IntelligenceHookConfig` | interface | `withIntelligence` config = the Observe config plus the pull target, refresh |
| `ModeReadiness` | interface | One mode's readiness verdict. |
| `ProfileImprovementActivationTransitionInput` | interface | A measured profile change without raw profile bytes. |
| `ProposeAgentProfileImprovementOptions` | interface | Complete profile-improvement path for a product-owned source. |
| `ProposeAuthoredAgentProfileImprovementOptions` | interface | Measure a complete human-authored, imported, or compound profile candidate. |
| `ProposedProfileDiff` | interface | A gate-certified profile diff the plane has already promoted, plus the |
| `ProtectedExactProcessCandidateExperimentExecutor` | interface | Exact-process executor plus the ports required for durable recovery. |
| `RecordTraceMeta` | interface | Metadata for {@link IntelligenceClient.recordTrace}. |
| `RepoConfig` | interface | Repo coordinates a product may declare for the (later) Gated-PR mode. The |
| `RunRecord` | interface | The typed record `withIntelligence` sends per call — serialized through the |
| `RunReport` | interface | What an agent reports (via `applied.record`) to enrich the {@link RunRecord} |
| `TraceHandle` | interface | The trace handle a `traceRun` body records into. `recordOutput` captures the |
| `TraceMeta` | interface | Metadata describing one traced run. `runId`/`traceId` default to fresh ids. |
| `UsageSplit` | interface | The per-class cost split carried by every trace and outcome. `off` ⇒ |
| `AgentCandidateExecutionHostPorts` | type | Product-owned candidate ports other than protected model access. |
| `AgentEnvironmentProviderRef` | type | Provider object or registry name accepted by runtime provider adapters. |
| `AgentImprovementEvaluation` | type | A reviewable measured result can come from a sealed executor or a normal profile executor. |
| `AgentImprovementExperimentMaterial` | type | Product-supplied experiment material. Runtime supplies optimizer ancestry and the final digest. |
| `AgentImprovementProfileStateDigest` | type | Product-defined hash of the complete profile state that actually runs. |
| `AgentImprovementProfileStateResolver` | type | Product-owned retained-state lookup used only for an explicit restore. |
| `AgentProfileImprovementMethodOptions` | type | The portable profile changes that the measured-profile contract permits. |
| `AuthoredAgentProfileCandidateLineage` | type | Lineage accepted by the direct candidate path. Optimizer lineage belongs to `improve()`. |
| `CapabilityAuth` | type | How a binding authenticates at resolve time. Declared as a REQUIREMENT in the |
| `CapabilityInterface` | type | What the agent consumes. CLOSED — a new runtime kind NEVER extends this. Each |
| `ContentRef` | type | Where a capability's bytes live. A leaked manifest carries no live secret and |
| `CorpusAccess` | type | Corpus access an intelligence tier permits. `'off'` reads and writes |
| `DeliveryBinding` | type | Describes how a capability is backed. |
| `EffortTier` | type | The named effort tiers, lowest to highest. `'off'` is the honest floor |
| `IntelligenceAgent` | type | An agent wrapped by {@link withIntelligence}: receives the input plus the |
| `IntelligenceWrapped` | type | The wrapped agent — same `(input) => Promise<output>` shape, plus a manual |
| `JsonSchema` | type | A structural JSON Schema object describing a tool's parameters. |
| `PullOutcome` | type | Typed outcome for the pull — inspect `succeeded` before `value`. A 404 |
| `Redactor` | type | A redactor maps an arbitrary trace value to a safe-to-export value. Pure; |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentCandidateExperimentCellPlacement`, `AgentImprovementActivationTargetPlan`, `AgentImprovementProfileReplacement`, `AgentImprovementProfileStateDigestInput`, `AgentImprovementProfileStateResolverInput`, `AgentImprovementProposal`, `AgentImprovementTargetProfileDiffOptions`, `AgentProfileImprovementActivationTargetPlan`, `CreateAgentImprovementActivationOptions`, `CreateAgentImprovementActivationResultOptions`, `CreateAgentImprovementProposalOptions`, `CreateExactProcessCandidateExperimentExecutorOptions`, `ExactProcessCandidateExperimentExecution`, `ExactProcessCandidateExperimentExecutor`, `ExecuteAgentCandidateExperimentCellOptions`, `ExecuteAgentImprovementActivationInput`, `ExecuteAgentImprovementActivationOptions`, `OptimizationActivationReceipt`, `OptimizationReceiptCost`, `PrepareAgentCandidateExecutionOptions`, `ProposeAgentImprovementOptions`, `ProposeAgentImprovementResult`, `ProposeAgentProfileImprovementResult`, `ProposeAuthoredAgentProfileImprovementResult`, `PullCertifiedOptions`, `ReviewAgentImprovementInput`, `RunAgentCandidateExperimentOptions`, `RunAgentCandidateExperimentResult`, `SealedCandidateActivationTransitionInput`, `VerifyCandidateExecutionEvidenceOptions`, `AgentImprovementActivationIntent`, `AgentImprovementActivationOutcome`, `AgentImprovementActivationTargetIdentity`, `AgentImprovementActivationTransitionInput`, `AgentImprovementAnalysisOptions`, `AgentImprovementProfileActivationInput`, `AgentImprovementProfileActivationPreparation`, `AgentImprovementProfileActivationTarget`, `AgentImprovementProfileSurface`, `AgentImprovementProfileTargetState`, `AgentImprovementProfileTargetTransition`, `AgentImprovementReviewDecision`, `AgentProfileImprovementActivationOperation`, `AgentProfileMeasuredSurface`, `ImproveResult`.

### Execution kernel — recursive atom, supervision, executors, round-synchronous loop

Import from `@tangle-network/agent-runtime/kernel` — 1035 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `acquireSandbox` | function | Cold-start-resilient sandbox acquisition: create by name, observe readiness from the sandbox's own status (not the create call), and re-attach after gateway timeouts. |
| `addHarnessUsage` | function | Sum two usage reports on every counter both of them state. |
| `admitContinuationPolicy` | function | Resolve and check a policy before any compute. Returns the deadline in epoch ms, or undefined |
| `allWorkersStalled` | function | "Everyone is stuck." Fires when every live worker reads `stalled` — no metered activity for |
| `analystsFromRegistry` | function | Adapt an `agent-eval` `AnalystRegistry` into the lens shape `supervise({ analysts })` takes. |
| `analyzeTrace` | function | Collect the source's spans and run the agent-eval batch analyzers over them under one `runId`. |
| `anyOf` | function | Stop when ANY rule stops — the ordinary composition (each rule is a separate reason to end). |
| `anytimeReport` | function | Derive anytime metrics from waterfall spans. `targets` are the satisficing score |
| `areaUnderCurve` | function | Mean of a best-so-far curve — the anytime AUC when the curve is normalized to [0,1]. Higher = |
| `asAuthoredProfile` | function | Narrow an untyped `spawn_worker` profile argument to an `AuthoredProfile`, or null if the |
| `assertDeclaredCheck` | function | Refuse a malformed declaration before any compute. |
| `assertProfileMaterializes` | function | Throw when the CHOSEN HARNESS has no control for a dimension the profile asks for. |
| `assertSearchSpec` | function | Check a spec and return its canonical frozen form: every axis present, no unknown key, no |
| `assertStrategyContract` | function | Static CONTRACT lint over an authored strategy module — the module-boundary |
| `assessAuthoredProfile` | function | OBSERVE one authored `AgentProfile` and score its richness (no judge verdict is read). The task |
| `attachWorker` | function | Reconstruct the exact provider-owned interactive process bound to one supervised worker. |
| `authorStrategy` | function | Author + load a strategy from losses. Throws when the author emits no loadable module; |
| `bestProfileFor` | function | The winning revision of a name, ready to mount. |
| `bestSoFar` | function | The best-so-far fold — the ONE definition of "how good was the run after k results", shared by |
| `boxSurfaceReader` | function | A {@link SurfaceReader} over a sandbox box's filesystem — the same `box.fs.read` seam |
| `breadthStrategy` | function | BREADTH: K independent rollouts (each own artifact), verifier picks the best. |
| `buildSteerContext` | function | Build the `SteerContext` a combinator reads to steer (its `loopUntil.until`, `widen` gate, any |
| `cancelRun` | function | Request the cancellation of the WHOLE run, idempotently, and return the operation's current |
| `cancelWorker` | function | Request the cancellation of ONE worker, idempotently, and return the operation's current |
| `canDisplace` | function | The repair keep-best guard: a challenger displaces the incumbent only when it is |
| `captureBoundHarnessTranscript` | function | Local native bytes enter the same artifact/settlement path as every other transcript. |
| `captureHarnessTranscript` | function | Read the harness transcript out of one LIVE environment. |
| `chatTransportExecutor` | function | Build one exact profile-driven chat executor through `createExecutor`. |
| `chatWorkerSeam` | function | Session-owning worker factory for graph continuity. |
| `checkProgramDigest` | function | The canonical digest of a check program's files: the digest a record names a program by. |
| `claimRetainedInteractiveControl` | function | Acquire provider-issued write authority without reading authority from status. |
| `claimsAuthority` | function | True when `text` carries a phrase reserved for the run's authority. Case-insensitive, because |
| `closingWorkerNote` | function | The worker's closing commentary off a local harness run: the TAIL of its |
| `collectAgentTurn` | function | Drain a `streamAgentTurn` stream (or any `RuntimeStreamEvent` stream that |
| `compareCheckOutcomes` | function | The selection order: crash < ran; then official pass-fraction; authored guesses only |
| `compileSearchSpec` | function | Compile a spec onto exactly one existing call. Every refusal names the axis or input and what |
| `completionAuthorizes` | function | Decide whether a `CompletionVerdict` may end the node under the policy: authority scales with the verdict's determinism, and probabilistic verdicts must clear `minConfidence`. |
| `composeCheckSources` | function | Concatenate check sources (official first by convention — ordering does not affect |
| `composeReentryTask` | function | Compose the task for one re-entered drive. |
| `composeWorkerEvidence` | function | Compose the settle evidence block. Section order is priority order under the |
| `computeFindingId` | function | Compute the stable finding_id from the identity-defining fields. |
| `connectRemoteSupervisor` | function | Connect with the server's readOnly URL and protected headers; credentials never enter a profile. |
| `connectRemoteSupervisorControl` | function | Connect with the dedicated /control capability, keeping credentials on the protected transport. |
| `connectStdioMcp` | function | Spawn a trusted host command, complete the stdio MCP handshake, and return |
| `contentAddress` | function | Stable content address shared by result and trace artifacts. |
| `copyUntrackedIntoClone` | function | Copy every untracked file of `sourceDir`'s working tree — including git-ignored |
| `createActivityLog` | function | Create a bounded activity ring. `limit` caps memory for a worker that runs thousands of tools. |
| `createAgentEnvironmentProviderRegistry` | function | Create a registry that resolves provider names to concrete provider instances. |
| `createBudgetPool` | function | Create a conserved reservation pool from a root `Budget`. `runStartedAtMs` is the WALL-CLOCK |
| `createChatSessionStore` | function | In-memory, process-local conversation store with detached reads and writes. |
| `createCodeModeTools` | function | Present an existing authorized tool set as code mode. This is used by Runtime's |
| `createCodexRolloutStoreReader` | function | Open an incremental reader over a codex store. |
| `createEventBus` | function | Create the child→parent coordination bus: one typed pipe for settled outputs, questions, and analyst findings, with a priority-ordered pull queue and a pass-through subscribe lane. |
| `createExecutor` | function | The single built-in executor factory. Picks a leaf backend by data (`config.backend`), |
| `createExecutorRegistry` | function | The open resolver/registry. Pre-registers the three built-ins under their |
| `createFencedSqlRunContext` | function | A cross-machine run context on the existing autocommit SqlAdapter. Reuse the same database, |
| `createFileRunContext` | function | Build a DURABLE run context: the spawn journal and the result blobs are file-backed (fsynced |
| `createInMemoryRunContext` | function | Build a fresh in-memory run context. Every call returns NEW stores (no shared global |
| `createInPlaceCliExecutor` | function | Build an in-place CLI leaf `Executor`. Per-spawn, but NOT per-workspace: repeated spawns against |
| `createMcpEnvironment` | function | Wrap any MCP server as an `Environment`: `tools/list` becomes `AgenticTool[]` with provider-safe schemas; the domain supplies only the artifact lifecycle hooks. |
| `createOtelExporter` | function | Create an OTLP/HTTP exporter. Returns undefined when no endpoint is configured. |
| `createPeerMailbox` | function | Create the run's post office. One per manager scope; the manager's siblings are its addresses. |
| `createPrivateCasArtifactPort` | function | Private content-addressed storage scoped to one recorded run identity. |
| `createPromptRegistry` | function | Create a registry, optionally seeded. Entries are copied; the registry never aliases caller state. |
| `createPushTraceSource` | function | A push source for OWNED tool loops (router-tools / cli-bridge tool dispatch): the loop calls |
| `createRootHandle` | function | Mint a `RootHandle` plus its supervisor-private control. The handle is the substrate a |
| `createS3PrivateCasStore` | function | Durable private CAS bytes in one S3-compatible bucket under `<prefix><namespace>/sha256/<hex>`. |
| `createSandboxLineage` | function | Build a lineage bound to one client. Branching is read from each box. |
| `createSandboxToolPartState` | function | Fresh per-turn {@link SandboxToolPartState} for {@link mapSandboxToolEvent} — an |
| `createScope` | function | Create the reactive `Scope` a driver's `Agent.act` runs inside: spawn children on an atomically reserved conserved budget, settle via the `next()` cursor, journal for replay. |
| `createScopeAnalyst` | function | Build a `ScopeAnalyst` that spawns the analyst agent through `Scope.spawn` (so its compute is |
| `createSteerableSandboxSession` | function | One steerable sandbox worker. The returned session is inert until `stream()` is drained. |
| `createSupervisor` | function | Create a supervisor that owns one recursive agent execution tree. |
| `createSupervisorSpanRecorder` | function | Build the span recorder for one run, or `undefined` when no exporter resolves (off by default; "configured but unreachable" also costs nothing). |
| `createVerifierEnvironment` | function | Any checkable task as an `Environment`, no tool surface required: the artifact is the worker's answer and the domain is one deployable `check` over it. |
| `createWaterfallCollector` | function | Build a `WaterfallCollector` that records agent spans and renders them as an ASCII timeline. |
| `createWorkerSlots` | function | Create a worker-slot allocator. `max` omitted, `0`, or negative leaves concurrency bounded by the |
| `createWorktreeCliExecutor` | function | Build a worktree-CLI leaf `Executor`. Per-spawn (a fresh worktree + abort + teardown each), so a |
| `declaredCheckDeliverable` | function | The declared check as a manager's completion check: every in-run read uses development cases. |
| `declaredCheckDigest` | function | The digest a version judge records: the program, the sealed cases, and how they are run. |
| `declaredCheckJudge` | function | The declared check as a version chain's judge: it scores a settled version on its sealed cases |
| `decodeHarnessUsage` | function | Decode a sandbox event with one harness's adapter, or `undefined` when the event carries no |
| `defaultExtractCandidate` | function | The candidate a shot produced, read from its conversation: the LAST `submit_answer` |
| `defaultSelectWinner` | function | The kernel's winner argmax — best-valid-score, ties broken by earliest index, |
| `defaultToolDetectors` | function | The default online panel for a tool-call pipe: a worker repeating the same call, or hammering |
| `defineLeaderboard` | function | Assemble a declarative spec (`cases` + `prompt` + `score`) into a runnable |
| `definePersona` | function | Build a frozen `Persona`. Fails loud on the executors-supplied invariant: a persona with |
| `defineStrategy` | function | Author a Strategy from the composable steps — the open, compact way. |
| `delegate` | function | Delegate an INTENT to a default authoring supervisor and return its `SupervisedResult` unchanged. |
| `depthStrategy` | function | DEPTH: one persistent artifact, carried across analyst-steered shots. |
| `deterministicCompletion` | function | Completion for a DETERMINISTIC check (build/test/lint/citation/proof): done iff the check |
| `digestOfGraph` | function | Digest of a runnable graph exactly as the registry stores it — the value |
| `envKeyProvider` | function | The env-backed provider: reads the (dotenvx-loaded) process env. Empty / |
| `equalKOnCost` | function | Assert the arms are comparable at EQUAL conserved COST (tokens + usd), NOT raw iteration |
| `extractLlmCallEvent` | function | Extract a `RuntimeStreamEvent`-shaped `llm_call` from a sandbox event when |
| `failuresAnalyst` | function | The default self-improvement LENS — authored content, not a code path. On each settled worker it hands |
| `fanout` | function | `fanout(items, opts)` — spawn one child per item in a single round (bounded by the conserved |
| `filterAuthoredAsserts` | function | The proven authored-assert filter (lifted from the rigs' generateTests): keep only |
| `flatWidenGate` | function | The flat default `ScopeWidenGate` — never widens, keeping the R2 selector≠judge collision |
| `formatPromptHandle` | function | The string form of a handle: `<surface>/v<n>`. |
| `freeSlots` | function | Free worker slots under a simultaneity cap: `cap - live`, floored at 0, or `null` when there is |
| `fsSurfaceReader` | function | A {@link SurfaceReader} over the local filesystem, for worktree/local workers. Every path — |
| `gateOnDeliverable` | function | Wrap an `Executor` so its settlement `valid` reflects the deliverable check, not the |
| `gitWorkspace` | function | A `Workspace` over a git checkout: materialize an isolated worktree at `ref`, commit produced changes (conflict-aware), and read `head` — hooks disabled, identity pinned. |
| `graphCorpusSummary` | function | Query and rank the same registry records using the opt-in observational |
| `graphDesignerExtraTools` | function | The designer's three tools over one registry. Record-every-run is enforced |
| `graphDigest` | function | Digest of the exact graph (nodes + edges + budget + deliverable describe, and a flow graph's |
| `graphFromSessionFacts` | function | Project an existing canonical span run tree into an observed graph design, |
| `graphFromStored` | function | Rehydrate a stored graph, binding trigger data and an environment-owned named check. |
| `graphRegistry` | function | Open (or lazily create) a registry rooted at a workspace directory. The |
| `graphRunsFor` | function | Records for one task shape or deterministic label query, newest last. |
| `harnessTranscriptArtifact` | function | Rehydrate the exact persisted transcript a receipt points at, or `undefined` when the receipt |
| `harnessUsageIsEmpty` | function | True when a report states any spend at all. |
| `harvestCorpus` | function | Batch the selected observation implementation over completed runs and retain its findings. |
| `harvestSurfaceDiffs` | function | Re-read every mounted (and watched) surface and report the ones whose settled state differs from |
| `inlineSandboxClient` | function | Adapt an `ExecutorFactory` into a `SandboxClient` for `runAgentRounds`. The factory is |
| `inProcessSandboxClient` | function | Adapt a single `onPrompt(prompt, ctx)` callback into a `SandboxClient` for |
| `isPeerMailEnvelope` | function | True when `value` is an envelope this runtime produced. The worker inbox parses with this, so a |
| `isPreSpawnExecutorFailure` | function | True when `error` is a backend refusal issued before anything ran. |
| `jjWorkspace` | function | A jj-backed `Workspace` (Jujutsu, colocated with git for the durable remote). |
| `kernelPromptRegistry` | function | The kernel's seeded registry: every surface the runtime's own builders derive from. A caller |
| `leaderboard` | function | Aggregate a fleet of records into the ranked, multi-axis report. Pure — no IO, deterministic. |
| `legacySupervisorRunDir` | function | Where a pre-rename writer put the same run (`<root>/.loops/supervisor/<id>`). Readers that must |
| `listGraphRuns` | function | All records, newest last. |
| `loadGraph` | function | Load a stored graph by digest. |
| `loadGraphFile` | function | Compile canonical YAML/JSON to content-addressed graph data. Host resolvers may perform I/O. |
| `loadProfile` | function | Load a stored profile revision by digest (for replaying the winning revision). |
| `loadSpawnForest` | function | Load every journal tree owned by one recursive supervision run and flatten its nodes/events. |
| `localShell` | function | Host-process `Shell`: run a command via `execFile`, resolving `{ stdout, stderr, code }` (never throws on non-zero exit). |
| `lookupGraph` | function | The designer's lookup: replay the known-good graph for this task shape, or |
| `loopCampaignDispatch` | function | Adapter for plain `runCampaign` scenarios. This is the Runtime-side pair for |
| `loopDispatch` | function | Adapter for `runProfileMatrix` (profile is an axis). Returns a |
| `loopUntil` | function | `loopUntil(seed, spec)` — one `step` child per round; `fold` accumulates each settlement into |
| `makeFinding` | function | Convenience factory: produce a fully-formed AnalystFinding with the |
| `mapExecutorResult` | function | Transform a Runtime executor's terminal artifact without losing its private |
| `mapSandboxEvent` | function | Project one `SandboxEvent` onto the `RuntimeStreamEvent` chat-UX vocabulary, |
| `mapSandboxToolEvent` | function | Project one `SandboxEvent` onto the `tool_call` / `tool_result` variants of |
| `materializeLocalMcp` | function | Spawn every enabled stdio server in `profile.mcp` and expose their tools as |
| `materializeTreeView` | function | Materialize a recorded `TreeView` from a journaled event list for inspection. Folds |
| `modelAuthoredChecks` | function | Default authored-check source: one metered LLM call per task, before sampling, |
| `noProgressFor` | function | "Nothing new has happened." Fires when the run has produced no new settled work for `ms`, or no |
| `observationFromRegistry` | function | Adapt any Eval analyst registry, including recursive engines, to observation and harvesting. |
| `observe` | function | Analyze through the selected implementation, then retain its validated findings in the corpus. |
| `officialChecksFromMeta` | function | Official checks the surface stashed on the task (e.g. MBPP's shown assert). Reads |
| `openSandboxRun` | function | Open a sandbox run. Harness-agnostic: the harness lives in |
| `openSqlRunStore` | function | Append-only immutable records, published by ONE compare-and-set of the run's head. |
| `pairwiseSignificance` | function | Compare EVERY profile pair on the scenarios they both ran — paired-bootstrap effect + CI, a real |
| `panel` | function | `panel(spec)` — spawn the M judge children over the SAME artifact, drain their settlements, |
| `parseWorkerToolTraceArtifact` | function | Validate a stored trace artifact before an analyst or replay trusts it. |
| `peerMailTools` | function | The two tools ONE capability serves. `capabilityId` is closed over and `from` is not a parameter, |
| `persistHarnessTranscript` | function | Persist a capture under its own content ref and return the receipt a settlement carries. |
| `pickBestGraph` | function | The documented heuristic: delivered beats failed; among delivered, cheaper |
| `pickBestProfile` | function | The best revision of a name by the same documented heuristic as the graph |
| `pipeline` | function | `pipeline(stages)` — run the stages in order, feeding each stage's `done` deliverable into the |
| `plateau` | function | "The objective has stopped climbing." Fires when the best-so-far curve has risen by no more than |
| `plateauLength` | function | How many trailing entries of a best-so-far curve are within `minDelta` of the curve's value |
| `printBenchmarkReport` | function | Pretty-print a report — the "free optimization" verdict, with the cost vector. |
| `profileChatClient` | function | Profile-exact adapter for packages that consume agent-eval's ChatClient contract. |
| `profileOptimizerModelCall` | function | Profile-exact adapter for agent-eval's external optimizer callback. |
| `profileRegistry` | function | Open (or lazily create) a profile registry rooted at a workspace directory. |
| `profileRichnessFinding` | function | Turn a {@link ProfileRichness} verdict into a bus-routable `AnalystFinding` (area `profile-quality`). |
| `profileRunsForName` | function | All records for one name, newest last. |
| `promptHandle` | function | Parse `'<surface>/v<n>'` into a {@link PromptHandle}. The shorthand for authoring a graph edge: |
| `providerAsExecutor` | function | Adapt an environment provider into an `ExecutorFactory` for `createExecutor`. |
| `providerAsSandboxClient` | function | Expose a neutral provider through the existing Sandbox client port. |
| `provisionSupervisor` | function | Provision one real provider-backed worker and keep its owning manager alive for controls. |
| `queueOf` | function | Convenience: a `DispatchUnit` factory over a fixed array of tasks, for the common case where |
| `readBoundHarnessSessions` | function | Verify a bound native family without owning a store, filesystem layout or native parser. |
| `readCodexRolloutSession` | function | Read one rollout's rows into a session record. |
| `readDeclaredCheck` | function | Read the check once. `result` is the submitted result, absent for a read of the run's state. |
| `readRunCancellation` | function | Read the acknowledgement for the run-scoped cancel operation. `undefined` when the runtime has |
| `readRunCancelRequest` | function | Read the run-scoped cancel request, or `undefined` when none was written. |
| `readRunParking` | function | Read the journal's bounded parking projection. Undefined means no current parking handoff. |
| `readWorkerCancellation` | function | Read the acknowledgement for one cancel operation. `undefined` when the runtime has not |
| `readWorkerInteractiveBinding` | function | Read and validate one exact durable worker binding. |
| `readWorkerProgress` | function | Fold the scope-derived facts and the executor's optional enrichment into one read. Pure: the |
| `readWorkerSteerAcknowledgement` | function | Read one runtime steer acknowledgement, or `undefined` while no manager has answered. |
| `readWorkerSteerRequests` | function | Read every atomically admitted request for one exact worker id, in admission order. |
| `reconnectRetainedInteractiveRun` | function | Rebuild controls for one exact provider-owned coding-agent process. |
| `reconnectRetainedRun` | function | Rebuild a retained-run client without retaining any object from the starter. |
| `recordGraphRun` | function | Append one run record; the exact graph is content-addressed beside it. |
| `recordProfileRun` | function | Record one run and persist the exact profile revision beside it. The |
| `recordStoredGraphRun` | function | Store an executable graph or an observed external topology in the same registry. |
| `recoverRetainedInteractiveRun` | function | Retry one exact start after its provider response may have been lost. |
| `recoverRetainedRun` | function | Rebuild the exact run named by a persisted pre-create intent or pre-dispatch |
| `registryScopeAnalyst` | function | A `ScopeAnalyst` backed by an `AnalystRegistry` — the panel-of-analysts seam. The registry merges |
| `renderAnytimeTable` | function | One row per (strategy, satisficing target): the shareable time-to-satisfactory table. |
| `renderCorpusToInstructions` | function | The learning-flywheel READ side. Queries the corpus through `filter`, renders the matching facts |
| `renderLeaderboardHtml` | function | Render a self-contained HTML leaderboard page (the hosted surface): the SVG charts + the full Markdown |
| `renderLeaderboardMarkdown` | function | Render the report as a publishable Markdown document: provenance → leaderboard → the full profile×axis |
| `renderLeaderboardSvg` | function | Render a self-contained SVG: a ranked score bar chart on top, the profile×axis heatmap below. No deps, |
| `renderPairwiseMarkdown` | function | Render the pairwise-significance table — every profile pair's paired delta, CI, and BH-corrected |
| `renderReport` | function | Operator-facing report, split by who should act. The agent block is the |
| `replaySpawnTree` | function | Re-feed a journaled spawn tree in strict `seq` order, rehydrating each settled |
| `resolveAgentEnvironmentProvider` | function | Resolve a provider instance or registry name, failing loudly when a name is unknown. |
| `resolveEntrySymbol` | function | The symbol authored checks are pinned to: `task.meta.entryPoint` when the surface |
| `resolveHarnessTranscriptCapture` | function | Read native metadata without archive I/O, or verify retained bytes before projecting bounded text. |
| `resolveMcpServerLaunch` | function | Resolve a profile MCP server's `args`/`env` config values (interface ≥0.40 |
| `resolveSandboxClient` | function | Resolve a `SandboxClient` for the chosen backend. The generic, dep-light core |
| `resolveSecretEnv` | function | Resolve a declared secret-env map into the real env entries for a server |
| `resolveWorkerSpawnRetry` | function | Read the policy, refusing a number a run cannot act on rather than silently clamping it. |
| `retainHarnessTranscript` | function | Describe already-verified retention, without reading the environment or copying archive bytes. |
| `retryPreSpawnRefusals` | function | Re-enter `execute` on one executor while a pre-spawn refusal keeps proving nothing ran. |
| `rollingDispatch` | function | Run the refilling dispatch loop over `scope` until the queue is dry (or a stop fires) and every |
| `runAgentic` | function | Run a Strategy through the keystone Supervisor — `Agent.act` over a conserved-budget Scope. |
| `runAgentRounds` | function | The round-synchronous MULTI-AGENT kernel: each round `driver.plan()` fans N tasks |
| `runBenchmark` | function | Run the requested strategies over the tasks, scored by the Environment's own check. |
| `runCodeMode` | function | Execute a JS async-function body against Runtime capabilities. The upstream |
| `runGraph` | function | Execute an {@link AgentGraph}. A flow graph (`entry` set) runs from its entries and routes edges |
| `runInWorkspace` | function | Run a worker `body` inside a FRESH clone of a shared `Workspace`, then commit its work back |
| `runIsolatedCheck` | function | Run an untrusted check in Linux Bubblewrap, or in its own Sandbox box when `box` is set. |
| `runPersonified` | function | Compose the persona + chosen shape onto a fresh keystone `Supervisor`. Resolves the shape |
| `runStrategyEvolution` | function | Evolve a strategy on the search kernel and claim once on the sealed test split. |
| `runTaskQueue` | function | Admit bounded work and yield settlements for the caller's policy to interpret. |
| `runToolSpans` | function | Every span of a manager's run: its own root stream, then each settled worker's tool trace. A |
| `safeWorkerFile` | function | A worker label reduced to a safe filename stem. Empty labels get a stable fallback. |
| `sandboxCheckRunner` | function | Default CheckRunner backend: pipes the check program into `python3` over the sandbox |
| `sanitizeMcpToolSchema` | function | Coerce an MCP inputSchema to an OpenAI-tool-valid top-level object schema. |
| `searchSpecDigest` | function | The canonical digest of a spec: equal for two specs that mean the same, different otherwise. |
| `secretEnvOfMcpServer` | function | Read (and validate) a server entry's declared secret-env map, if any. |
| `selectBestIndex` | function | Argmax by `compareCheckOutcomes`, FIRST index wins ties (deterministic; with zero |
| `selectValidWinner` | function | The single content-free valid-only winner selector. Among the gated-VALID children only |
| `sentinelCompletion` | function | Completion for a sandbox-agent node: done iff the latest output carries the node's stop |
| `serveCoordinationMcp` | function | Stand up the existing coordination tools with bounded HTTP access over one live scope. |
| `settledToIteration` | function | The step-8 merge-boundary adapter (M4): rehydrate a `Settled.done` into the kernel's |
| `settledWorkerOut` | function | What a settled worker exposes as its output artifact (the blob the brain's |
| `sharedBoxPlacement` | function | Place accepted workers as processes in a pool of shared Sandbox boxes. |
| `sharedBoxRefusal` | function | Why a shared box cannot carry `profile`, or `undefined` when it can. |
| `sharedWorkerClientName` | function | The router client name of the worker that runs supervised node `nodeId`. |
| `spendFromUsageEvents` | function | Fold a normalized `UsageEvent` array into a `Spend`. Tokens and usd are separate |
| `startRetainedInteractiveRun` | function | Start one retry-safe native coding-agent TUI without dispatching a headless turn. |
| `startRetainedRun` | function | Dispatch one detached, replayable run and return only after exact durable |
| `startRetainedRunInEnvironment` | function | Dispatch a fresh retained session inside an existing provider environment. |
| `stopSentinel` | function | A unique, attributable stop sentinel for a node (ralph-loop style). Deterministic from the |
| `storedGraphDigests` | function | Digests present on disk (integrity probe for tests and audits). |
| `strategyTournament` | function | The tournament on one split, projected from the ledger: each settled cell's final attempt, |
| `streamAgentTurn` | function | Run ONE agent turn on any backend kind and stream its events. Yields the |
| `structuralRollout` | function | Build the structuralRollout `Strategy`: k shots → score each by the frozen visible |
| `subscriptionUsageLimitSignal` | function | Normalize a native harness refusal into a typed limit. A plain HTTP 429 is insufficient. |
| `sumSandboxUsage` | function | Sum the token usage + USD cost of a sandbox turn's events — the one honest way to meter an |
| `supervise` | function | One-call supervisor: build + run a supervisor from its exact profile. |
| `superviseDispatch` | function | Run one recursive supervised tree inside Eval's pre-execution paid-call lifecycle. |
| `supervisorAgent` | function | Build a supervisor `Agent` from its profile: the brain resolves from `profile.harness` |
| `supervisorInstructions` | function | The supervisor skill: an explicit profile-authoring instruction, never an implicit Runtime |
| `supervisorRunDir` | function | The run directory every artifact of one supervisor run lives under. |
| `supervisorRunsRoot` | function | The root every supervisor run of one workspace lives under. |
| `taskShapeDigest` | function | Digest of the normalized task shape a designer looks records up by. |
| `trajectoryReport` | function | Reconstruct the whole spawn tree for `root` with per-node + rolled-up `Spend`. Reads the |
| `validateStoredGraph` | function | Validate compiled, runnable StoredGraph data. Authored params/seats/on envelopes belong to |
| `verdictFromJudgeScore` | function | Read an agent-eval `JudgeScore` from a check program into a verdict. |
| `verify` | function | `verify(spec)` — an IMPLEMENT child produces a candidate, then a SEPARATE VERIFIER child grades |
| `visibleCheckScore` | function | Display scalar for receipts/reports (the rigs' `visibleScore` shape): crash = -1, |
| `watchTrace` | function | Subscribe to a `TraceSource` and run the streaming detectors over its live spans. Returns an |
| `widen` | function | `widen(spec)` — the streaming spawn-on-completion driver. Spawns the seed lineages, then REACTS |
| `withRunContext` | function | Hold a run context's ownership (when it has any) across the whole run, releasing after. |
| `withUntrackedArtifacts` | function | Wrap a `Workspace` so every `materialize` (the per-worker `git clone` inside |
| `withWorkerSpawnRetry` | function | Wrap a worker seam so a leaf whose spawn is refused before it runs is re-entered instead of |
| `workerFromBackend` | function | Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the |
| `workerFromInteractiveProvider` | function | Build a `MakeWorkerAgent` that starts one provider-owned native TUI per worker. A Scope supplies |
| `workerInboxFileFromEventDir` | function | Same, addressed from an already-known run directory (the reader's usual entry point). |
| `worktreeFanout` | function | Build the worktree fanout combinator. Run it with `runPersonified({ persona, shape, task, budget })` |
| `writeWorkerSteer` | function | Admit one steer exactly once under a caller-owned operation id. |
| `adaptiveRefine` | const | A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot |
| `analyzesFindingsReportPrompt` | const | Default ANALYZES-edge directive: what the RECEIVING node should do with an analyst's findings. |
| `assertTraceDerivedFindings` | const | Reject analyst findings derived from evaluation scores instead of execution traces. |
| `AUTHORITY_MARKERS` | const | Phrases that mark the run's AUTHORITY in a folded prompt. A peer that writes one of these is |
| `bestDelivered` | const | Keep-best under the completion oracle — the DEFAULT finalizer and the exact behavior every |
| `DEFAULT_MAX_DEPTH` | const | The default recursion-depth ceiling. The conserved pool bounds depth (every level draws its |
| `DEFAULT_PEER_MAIL_LIMITS` | const | Bounds chosen so a peer channel cannot become the dominant cost of a run: eight sends and |
| `DEFAULT_SANDBOX_STEERING_MAX_TURNS` | const | Ceiling on continuation turns (turn 0 is the task, each later turn a folded steer). |
| `DEFAULT_SHARED_BOX_RESOURCES` | const | The box shape the default placement creates: memory for 8 workers at about 0.5 GB each plus |
| `DEFAULT_SHARED_BOX_WORKERS` | const | The most workers one default box carries at once. |
| `DEFAULT_STALL_AFTER_MS` | const | How long a worker may produce no metered activity before a `progress()` read calls it stalled. |
| `defaultAnalystInstruction` | const | The default observer instruction — exported so an optimizer can seed its population. |
| `defaultDelegateBudget` | const | The conserved pool a `delegate()` call applies when the caller does not pass its own `budget`. |
| `defaultEdgeTraversalCap` | const | Default per-edge traversal cap — the cyclic-graph backstop when an edge names none. |
| `defaultProfileRichnessThresholds` | const | Default thresholds for `ProfileRichnessThresholds` — 600 chars / 6 lines minimum system prompt. |
| `defaultStructuralRolloutPolicy` | const | The measured default recipe: 5 samples, 2 guarded repair rounds, 6 authored checks. |
| `delegatesWorkerBriefPrompt` | const | Default DELEGATES-edge directive: the standing instruction a worker receives with every |
| `dumbContinuationFailPrompt` | const | Default DUMB steering continuations — the pass/fail-only control re-expressed as data: two |
| `dumbContinuationPassPrompt` | const | The pass branch of the dumb steering control — see {@link dumbContinuationFailPrompt}. |
| `EVIDENCE_MAX_CHARS` | const | Hard cap on one worker's evidence block so the brain's context cannot blow up. |
| `graphFileSchema` | const | Authoring envelope. Canonical profiles and topology are validated by their existing owners. |
| `graphRouteWhenSchema` | const | The same data grammar as routes; no executable expressions or additional operators. |
| `HARNESS_TRANSCRIPT_READ_LIMITS` | const | One native capture/read bound per child; replay resolves references rather than copying bytes. |
| `HARNESS_TRANSCRIPT_SETTLE_TIMEOUT_MS` | const | The longest a settle waits for an executor's final transcript. The provider executor's own |
| `mcpSecretEnvMetadataKey` | const | The `AgentProfileMcpServer.metadata` key the declarative secret-env map |
| `naiveContinuationPrompt` | const | Default NAIVE steering continuation — the no-signal control re-expressed as data: the same |
| `NOTE_MAX_CHARS` | const | Cap on the worker's closing note inside the evidence block. |
| `PEER_MAIL_WIRE_KEY` | const | The wire property carrying an envelope to a worker inbox. Deliberately its OWN discriminant: |
| `peerMailVerbNames` | const | The tool names a mail capability endpoint serves. It serves NOTHING else. |
| `questionEscalationTargets` | const | Where a question this driver cannot answer goes next. `answer_question` accepts these and |
| `refine` | const | Built-in `Strategy`: attempt → `observe()` reads the trace → steer the next attempt → repeat (deepen one lineage). |
| `ROUTER_CLIENT_HEADER` | const | The request header the router records as a usage row's `clientName`. |
| `sample` | const | Built-in `Strategy`: K independent attempts, keep the best-verifying (best-of-N / resample). |
| `sampleThenRefine` | const | The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open), |
| `SEARCH_SPEC_CORRELATION_KEY` | const | The correlation key the compiled call records the spec's digest under. Runtime writes it; a |
| `searchPresets` | const | The five configurations Runtime ships, as specs. Each is an ordinary spec: its digest is its |
| `strategyAuthorContract` | const | The compressed consumable a skill carries: everything an author needs to emit a loop. |
| `strategyAuthorSystemPrompt` | const | Standing behavior callers put in the strategy-author AgentProfile. |
| `superviseFleetCapabilities` | const | Capabilities a data-only consumer may require before building an opted-in run. `graphTools`: |
| `TERMINAL_DECISIONS` | const | Decision values the kernel treats as terminal. Every other value returned by |
| `TRACE_ROOT_SCHEMA` | const | Schema identifier of a stored {@link TraceRootArtifact}. |
| `TRACE_SUMMARY_SCHEMA` | const | Schema identifier of the {@link TraceSummary} carried by a trace root's last leaf. |
| `UNPROVEN_CONTINUITY` | const | Continuity when nothing is proven: compose the full state. |
| `VERIFY_TAIL_CHARS` | const | Tail of the verify output — the failing assertion lives at the END of a test log. |
| `CheckUnavailableError` | class | The check could not run: its box did not start, its judge's provider refused, its program |
| `FileCoordinationLog` | class | FS-backed `CoordinationLog`: append-only JSONL, fsynced per record. |
| `FileCorpus` | class | JSONL on disk — one validated `CorpusRecord` per line, append-only. `query` replays the whole |
| `FileResultBlobStore` | class | FS `ResultBlobStore`. One JSON file per artifact under `dir`, named by a |
| `FileSpawnJournal` | class | JSONL on disk. One line per record: the first record is `begin`, subsequent records |
| `GraphEdgeCapError` | class | A delegates edge exhausted its traversal cap and the run produced no winner: the cap, not the |
| `GraphFileResolutionError` | class | A provider name in authored data needs an environment-owned canonical connection binding. |
| `GraphRouteError` | class | A flow node's usable settle matched no routes edge leaving it (`unrouted`), or a fired edge named |
| `HarvestError` | class | The completed batch evidence remains available even when every analysis failed. |
| `InMemoryCorpus` | class | In-memory `Corpus`. Keyed by record `id`; `append` validates the record, is idempotent on an |
| `InMemoryResultBlobStore` | class | In-memory `ResultBlobStore`. Content-addressed: `put` verifies the supplied |
| `InMemorySpawnJournal` | class | In-memory `SpawnJournal`. Appends are observed-committed only; the impl enforces |
| `McpSpawnFault` | class | A missing start binary / spawn fault: a SETUP bug, never a failed candidate. |
| `ObservationError` | class | Analysis can fail after paid work; its measured subtotal must remain recoverable. |
| `RunCancellationReason` | class | Provenance of an explicit cancellation, preserved through every abort link. |
| `RunParkedError` | class | A resumable wait, with no terminal result or failure. Catch it and let the coordinator exit. |
| `SandboxInstance` | class | A sandbox instance with methods for interaction. |
| `SandboxRunAbortError` | class | Thrown when a turn is aborted/timed-out mid-settle. Carries the events drained |
| `SqlRunOwnershipError` | class | Refuses a competing or stale SQL run owner before it can publish new work. |
| `ActivityLog` | interface | A bounded newest-last ring of `ActivityNote`s an executor keeps to answer `progress()`. |
| `ActivityNote` | interface | The most recent activity the executor can name — one tool call, one turn, or a free-form note. |
| `Agent` | interface | One self-similar atom. A leaf is an `Agent` that never calls `scope.spawn`; a driver |
| `AgentEnvironmentProviderRegistry` | interface | In-memory registry for named `AgentEnvironmentProvider` instances. |
| `AgentExecutionRef` | interface | Caller-owned identity beyond the exact profile/task bytes Scope can compute itself. |
| `AgenticSurface` | interface | A stateful, checkable environment an agent operates over with tools. Open behind one interface. |
| `AgentProfile` | interface | Public provider-neutral agent profile contract. |
| `AgentRunSpec` | interface | Sandbox-SDK-shaped agent specification. |
| `AgentSpec` | interface | `AgentProfile` is the complete execution authority. Scope parses and snapshots it before calling |
| `AgentTurnUsage` | interface | Metered usage of one turn, summed over every cost-bearing event the backend |
| `AnalystAssignmentRecord` | interface | Exact analyst assignment recorded before execution. The existing spawn journal retains the |
| `AnalystAuthoring` | interface | What `analystsFromRegistry` needs before a manager may define its own lens. |
| `AnalystFinding` | interface | Unified envelope every analyst emits. Schema-versioned so renderers |
| `AnalystFindingEvent` | interface | A trace-analyst result re-entered as a message on the bus (the `finding` event kind). |
| `AnalystKind` | interface | One lens on the menu `list_analysts` shows and `run_analyst` resolves. |
| `AnalystRunContext` | interface | What the coordination layer hands one registry lens run. |
| `AttachWorkerOptions` | interface | Options for reconstructing one worker's exact retained interactive process. |
| `AuthoredAnalystDefinition` | interface | A trace analyst a MANAGER authored at run time: the research question, the policy for answering |
| `AuthoredAnalystLimits` | interface | Bounds on the recursive investigation a defined analyst may run. Each field is optional and is |
| `AuthorityInboxMessage` | interface | A message from the run's AUTHORITY — the parent driver. These two kinds carry instruction. |
| `BackendErrorDetail` | interface | Typed transport / backend failure detail. Carried on `backend_error` and |
| `BenchmarkCell` | interface | One strategy's outcome on one task — the per-task cell an optimizer consumes. |
| `BenchmarkReport` | interface | Benchmark output: per-strategy means plus the full per-task × per-strategy losses table an optimizer mines. |
| `BlockedToolReport` | interface | One `report_blocked` whose probe failed too. |
| `BoxSurfaceReaderOptions` | interface | Retry and cancellation controls for {@link boxSurfaceReader}. |
| `BridgeHarnessStore` | interface | A harness's own session store on the bridge host, named so the runtime may read it. |
| `BridgeModelCredential` | interface | A live, request-scoped model credential reference for a local cli-bridge. |
| `BridgeSeam` | interface | cli-bridge seam. A local OpenAI-compatible bridge that fronts harness CLIs |
| `Budget` | interface | A budget envelope on a spawn or the root. All ceilings; the pool reserves against them. |
| `BudgetOverspend` | interface | One channel on which a settled reservation's measured spend exceeded what it reserved. |
| `BudgetPoolRestore` | interface | State recovered from a prior process before new work is admitted. `committed` is measured spend |
| `BudgetViolation` | interface | A settled reservation whose measured spend exceeded what it reserved. |
| `BusEvent` | interface | Every bus event is a discriminated union member keyed by `type`. |
| `BusRecord` | interface | A published event stamped for ordering and observability. `seq` is the monotonic publish index; |
| `ChatSessionStore` | interface | Conversation history keyed by the settled Runtime worker id. |
| `ChatTransportExecutorOptions` | interface | Transport and session data for one exact profile-driven conversation. |
| `ChatTransportTool` | interface | One profile-authorized function tool and its host implementation. |
| `ChatWorkerSeamOptions` | interface | Transport/session configuration shared by every spawned exact profile. |
| `CheckExecChannel` | interface | Minimal exec channel the default runner needs. `SandboxInstance` (and therefore |
| `CheckOutcome` | interface | How one candidate fared against the frozen visible checks, split by check kind. |
| `CheckRunner` | interface | Executes the frozen checks against one candidate. Implementations MUST fail loud |
| `CheckSource` | interface | Produces the task's visible checks. MUST derive them from agent-visible information |
| `CheckSourceCtx` | interface | What a CheckSource composes with. `consult` is the strategy family's raw analyst |
| `CheckVerdict` | interface | One reading of a completion check. |
| `ClaimRetainedInteractiveControlOptions` | interface | Input for acquiring write authority over one exact interactive process. |
| `CliInPlaceSeam` | interface | cli-in-place seam. A supervisor-authored `AgentProfile` driving a local coding-harness CLI |
| `CliSeam` | interface | UNMETERED CLI subprocess seam. `bin` + `args` describe the process to spawn. |
| `CliWorktreeSeam` | interface | cli-worktree seam. A supervisor-authored `AgentProfile` driving a local coding-harness CLI |
| `CodeModeToolsOptions` | interface | Session data is explicit so the existing run owner can retain and restore it. |
| `CodexExecutionEvidence` | interface | Zero-model-call evidence for the exact Codex process about to run. |
| `CodexExecutionPolicy` | interface | Mutable public contract derived from the single enforced policy value. |
| `CodexRolloutIdentity` | interface | Who wrote one rollout, exactly as its own `session_meta` states it. Nothing here is inferred. |
| `CodexRolloutSession` | interface | One rollout file, read. |
| `CodexRolloutStoreReader` | interface | A store reader that credits each turn once: it tails only the bytes appended since the last read. |
| `CodexRolloutStoreRef` | interface | Where a harness keeps its own session store, and which workspace may be credited from it. |
| `CodexRolloutTurn` | interface | One turn of one session, with the counters it added to the session's cumulative total. |
| `CodexStoreDelta` | interface | What one incremental read of a store observed. |
| `CodexTokenUsage` | interface | Exact aggregate usage emitted by Codex's terminal `turn.completed` JSONL event. |
| `CollectedAgentTurn` | interface | A drained turn: the terminal summary plus every event the stream yielded. |
| `CompletionAnalyst` | interface | Reads a node's trace → a completion verdict. Same input shape as the `analyze` hook, so |
| `CompletionCheckContext` | interface | Kernel-owned leaf identity; never reconstructed from the worker's submitted output. |
| `CompletionEvidence` | interface | Trace-derived evidence for a completion claim — an artifact (output) or a verifier metric, |
| `CompletionPolicy` | interface | When a verdict authorizes the driver to END. Deterministic → trust (ground truth); |
| `CompletionVerdict` | interface | The "is it done?" verdict an analyst returns to the parent. |
| `ContinuationEntry` | interface | One continuation as the settle record carries it (`DriverContinuationRecord.continuations`). |
| `ContinuationInstruction` | interface | Durable authorization receipt written before a continuation reaches a worker. |
| `ContinuationPanelInput` | interface | What the question panel reads for one continuation. |
| `ContinuationPolicy` | interface | How a manager with a completion check is sent back when its turn ends unmet. |
| `ContinuationProfile` | interface | Every instruction word of the note. Runtime supplies the facts and their order; this data |
| `CoordinationControlAccess` | interface | Runtime-only owned-worker control capability, separate from read and manager authority. |
| `CoordinationLog` | interface | The durable coordination side-log seam. `append` records one bus event (kinds it does not |
| `CoordinationReadAccess` | interface | Runtime-only read capability delivered to an operator client, never to the canonical profile. |
| `CoordinationToolFace` | interface | One mounted coordination tool's static face; the handler is deliberately absent. |
| `CoordinationVerbs` | interface | The coordination verbs THIS manager serves, callable in code from a product tool handler. |
| `Corpus` | interface | The durable cross-run corpus — the learning-flywheel store. DISTINCT from `SpawnJournal` |
| `CorpusFilter` | interface | A corpus query filter — every field is an AND-narrowing; an omitted field does not constrain. |
| `CorpusRecord` | interface | One accreted fact in the cross-run corpus — the learning-flywheel's durable unit. DISTINCT from |
| `CreateSandboxOptions` | interface | Configuration for creating a new sandbox. |
| `CreateScopeAnalystOptions` | interface | The analyst run an `Agent<unknown, AnalystFinding[]>` performs over the children settled so far. |
| `DeclaredCheck` | interface | A check program as a record declares it. |
| `DeclaredCheckPlacement` | interface | Where a declared check's boxes are created: a client on the check account, and every account |
| `DefaultVerdict` | interface | Minimal verdict shape — `valid` + `score` are required; `scores` + |
| `DefinedAnalystRecord` | interface | What the coordination layer records when a definition is admitted: the exact accepted bytes, the |
| `DefinePersonaInput` | interface | The minimal input to build a `Persona`. Mirrors `Persona` but lets the builder default |
| `DelegateOptions` | interface | Inputs to {@link delegate}. The intent is the first positional arg; everything here is optional |
| `DeliverableSpec` | interface | The deployable completion oracle passed to {@link gateOnDeliverable}: a `check` that |
| `DeliveredOutput` | interface | One DELIVERED child, materialized: settled `done`, oracle-passed, output rehydrated. `out` is |
| `DesignerRunGraphEnv` | interface | How the ENVIRONMENT executes a graph the designer asked to run. |
| `DispatchUnit` | interface | One unit of queued work: the agent to run, its task, and the spawn options (budget + label). |
| `DownMessageDeliveryAttempt` | interface | A durable marker written after authorization and immediately before Runtime calls `Scope.send`. |
| `DownMessageEvent` | interface | A parent→child delivery result (the down-leg): recorded for observability, never pulled back by |
| `DriveHarness` | interface | How to run an external harness as the DRIVER, with the coordination verbs mounted — the substrate |
| `DriverAttemptRecord` | interface | One attempt's record — the legible failure the issue's third ask names. Emitted per attempt so |
| `DriverContinuationRecord` | interface | A manager's driver loop as its run's settle record carries it (`SupervisedResult.continuation`). |
| `DriverRetryPolicy` | interface | How hard the root driver is retried after a transient failure; `enabled: false` restores pre-#741 behavior. |
| `EdgeTraversal` | interface | One recorded edge traversal — the in-memory row; the journal twin is the `edge` SpawnEvent. |
| `EnvironmentTeardownReceipt` | interface | The receipt for one provider environment an executor held for a RETAINED execution and was |
| `EqualKArm` | interface | One arm of an equal-k comparison — a labeled trajectory (a `TrajectoryReport` is one arm's whole |
| `EqualKOnCostOptions` | interface | `equalKOnCost(arms, { tolerance? })` — assert arms are comparable at EQUAL conserved COST |
| `EqualKVerdict` | interface | The equal-k-on-cost verdict: whether every arm spent within `tolerance` of the others on the |
| `EventAcknowledgement` | interface | One acknowledgement record: which delivered events are now processed, and on whose word. |
| `EventBus` | interface | The child→parent coordination bus surface: publish, priority-ordered pull, pass-through subscribe, history, and stats. |
| `EvidencePendingEvent` | interface | Evidence debt, a {@link SpawnEvent} row: the workspace an accepted turn left in its retained |
| `EvolutionStrategy` | interface | One strategy the search registered, as the ledger records it. |
| `ExecCtx` | interface | Execution context for `runAgentRounds`: the sandbox client the kernel creates boxes through, plus optional runtime hooks. |
| `Executor` | interface | The leaf runtime — ONE open interface, not a closed union. `execute` returns a |
| `ExecutorAccounting` | interface | Split used by a recursive executor when journaled child work differs from the full amount |
| `ExecutorCancellation` | interface | What a backend acknowledged about one cancellation ask. |
| `ExecutorCancellationRequest` | interface | One cancellation ask. `operationId` makes the request idempotent per attempt, exactly as the |
| `ExecutorContext` | interface | Construction context handed to a `ExecutorFactory` — the seams a built-in needs |
| `ExecutorExecutionBinding` | interface | Volatile execution routing that is true for one attempt but is not profile identity. The full |
| `ExecutorMaterialization` | interface | Data-only declaration from trusted executor code about the exact sealed plan `execute` uses. |
| `ExecutorNodeContext` | interface | Kernel-owned context for the concrete supervised node a factory is constructing. |
| `ExecutorProgress` | interface | What an executor OPTIONALLY adds to the scope-derived progress (`Executor.progress()`). Every |
| `ExecutorRegistry` | interface | The OPEN resolver maps an already-admitted `AgentSpec` to an `ExecutorFactory`. Scope validates |
| `ExecutorResult` | interface | Terminal artifact of a one-shot `Executor.execute`. |
| `ExecutorTeardownWarning` | interface | A teardown failure recorded BESIDE a settled result rather than in place of it. |
| `ExecutorToolCall` | interface | One tool call retained in an executor artifact. Every Runtime-owned executor reports this exact |
| `FanoutOptions` | interface | `fanout(items, { synthesize? })` — N children spawned in one round (one per item, bounded by |
| `FanoutSynthesis` | interface | How a fanout's synthesis child is built + read. `synthesisTask` projects the drained child |
| `FencedSqlRunContext` | interface | A `RunContext` bound to one fenced SQL ownership generation; read-only until acquired. |
| `FinalizeContext` | interface | What a finalizer gets to decide with. `delivered` is the ONLY output material; `allSettled` |
| `FinalizerSettled` | interface | One settled worker as the finalizer sees it — the ledger row (structural fields only). |
| `FleetYield` | interface | How this run's spawned CHILDREN ended, counted by node id off the complete journal FOREST at |
| `GateRequest` | interface | What a gate asks its caller. `visit` is the 1-based count of times this run reached the gate; |
| `GraphCommandCheck` | interface | An environment-owned check command, run outside the agent's conversation. |
| `GraphCorpusGroup` | interface | Descriptive task-type/topology measurements, with every population explicit. |
| `GraphCorpusSummary` | interface | The registry's observational view. It neither authorizes replay nor proves a causal win. |
| `GraphNode` | interface | A graph node: an id and a canonical `AgentProfile`. The profile is the ONLY way a node is |
| `GraphRunQuery` | interface | Filters over the existing graph run records. Missing source kind is native. |
| `GraphRunRecord` | interface | One run or an explicitly incomplete observation of a graph, for one task shape. |
| `GraphSessionObservationOptions` | interface | Provenance and explicit labels for one imported run. spanRun is a structural |
| `GraphTopology` | interface | A topology without the run's own budget and deliverable: the form a `maps` edge runs per item, |
| `Handle` | interface | A live child handle. `abort()` is defined over the ACQUIRE lifecycle: it chains into |
| `HarnessTranscriptReadLimits` | interface | Projection limits do not change what the original archive retained. |
| `HarnessUsage` | interface | One harness's own token-usage report for one turn, in the runtime's field names. |
| `HarvestSurfaceDiffsOptions` | interface | Inputs to {@link harvestSurfaceDiffs}: the run's mount manifest, the read seam, and optional |
| `HeldEnvironment` | interface | One provider environment an executor holds, named by the provider's own id. |
| `HeldForContinuation` | interface | A budget-stopped turn's environment, held for a keyed continuation ({@link Executor.heldForContinuation}). |
| `InboxLease` | interface | Messages taken for one model input. Exactly one of `commit` per message or `release` settles |
| `InMemoryRunContext` | interface | The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`. |
| `InMemoryRunContextOptions` | interface | Options for a supervised run context. |
| `InPlaceHarnessResult` | interface | The canonical result of one in-place harness run. The edits are the DIRECTORY, not a patch: |
| `InProcessPromptCtx` | interface | Context handed to each `onPrompt` call. |
| `InteractiveWorkerKeyInput` | interface | Stable input available to key and holder functions. |
| `InteractiveWorkerOptions` | interface | Configuration shared by every worker produced by `workerFromInteractiveProvider`. |
| `InteractiveWorkerResult` | interface | Native interactive worker output. Provider usage is intentionally not fabricated. |
| `Interval` | interface | A 95%-by-default confidence interval. |
| `IsolatedCheckBox` | interface | A fresh Sandbox box for one check, owned by an account the judged run holds no key to. |
| `IsolatedCheckBoxEvidence` | interface | The box a check ran in and the exact bytes it received. |
| `KeyProvider` | interface | Resolve named secrets. The ONE seam every secret store adapts to. |
| `LeaderboardBenchmarkAdapter` | interface | Structurally `BenchmarkAdapter` (bench registry shape): `name`, |
| `LeaderboardBenchScore` | interface | Structurally `BenchScore` (bench registry shape). |
| `LeaderboardBenchTask` | interface | Structurally `BenchTask` (bench registry shape) — declared locally so this |
| `LeaderboardFlagSpec` | interface | One extra CLI flag a spec declares. Parsed by `run()` as `--<name> <value>` |
| `LeaderboardIterationInfo` | interface | Per-shot outcome context passed as `onCellEvents`'s third argument — how a |
| `LeaderboardRow` | interface | One leaderboard row — a harness×model profile, every measured column. |
| `LeaderboardRunContext` | interface | Resolved run configuration handed to `setup` / `teardown` / `export`. |
| `LeaderboardScenario` | interface | The campaign scenario a case is wrapped into: the case rides along so |
| `LeaderboardScore` | interface | Structured per-case verdict a `score` function may return (a bare number is |
| `LeaderboardSpec` | interface | The declarative leaderboard spec. `TArtifact` is the artifact channel the |
| `LeadMessage` | interface | A steer or an answer this manager received from its lead. |
| `LeakedReservation` | interface | One reservation still open at the join barrier — a pool leak, with the holder to chase. |
| `LocalMcpMaterialization` | interface | The live same-host materialization of a profile's `mcp` surface. |
| `LoopCampaignDispatchOptions` | interface | Options for adapting plain agent-eval campaign scenarios into Runtime cells. |
| `LoopIterationDispatchPayload` | interface | Where the iteration's worker was placed. `sibling` = a fresh sandbox the |
| `LoopLineageOptions` | interface | Opt-in box-lineage controls for `runAgentRounds`. Default OFF — with both flags |
| `LoopPlanPayload` | interface | Emitted once per `plan()` round, immediately after the driver plans. Carries |
| `LoopTeardownFailedPayload` | interface | Emitted when a box's `delete()` throws or times out during teardown — the |
| `LoopTokenUsage` | interface | LLM token usage. Structurally maps into agent-eval's paid-call receipt so a |
| `LoopUntilSpec` | interface | `loopUntil({ until, step })` — iterative deepening inside the conserved pool: spawn one `step` |
| `LoopUntilState` | interface | The accumulated state `loopUntil` threads across rounds — the running candidate + the round |
| `ManagerReentryState` | interface | What a manager's coordinator knows about its run, read when the manager is entered again. |
| `MapSpawnMarker` | interface | The runtime marker on a map's item or join spawn. |
| `MapTraversalEvent` | interface | One map step, published as a `map` event: the expansion of the source list, one item, or the |
| `MaterializedExecutionIdentity` | interface | External execution identity that operators can use to join this node to its backend. |
| `McpEndpoint` | interface | Where a handle's MCP server lives; headers carry per-artifact scoping. |
| `MountManifestEntry` | interface | One mounted resource recorded during box preparation — a pure provenance |
| `NativeContextContinuationHandle` | interface | Admission and terminal result for one same-session continuation. |
| `NodeExecutionIdentity` | interface | Durable identity of one realized node. Missing digests mean the input was not canonical JSON. |
| `NoWinnerError` | interface | A driver's `act()` rejection, normalized to serializable evidence so it survives the typed |
| `ObservedSessionFacts` | interface | Structural projection of traces' SessionFacts. The trace reader owns all |
| `OpenSandboxRunBeforeStartContext` | interface | Context available after the box/session exists and before the first prompt is |
| `OutputAdapter` | interface | Stream of `SandboxEvent`s → typed `Output`. |
| `PairwiseVerdict` | interface | One profile pair compared on the scenarios they BOTH ran — the "who actually beat whom" verdict. |
| `PanelFinding` | interface | One answer the panel proposes for the note. |
| `PanelJudge` | interface | One judge in a panel — a labeled persona-derived judge child. Content (the rubric) lives in |
| `PanelSpec` | interface | `panel(judges)` — M judges over ONE artifact, merged WRITE-ONLY (selector≠judge taken to its |
| `PanelVerdict` | interface | One judge child's settled verdict, surfaced to the write-only `merge`. `down` judges carry no |
| `ParkedRun` | interface | The current parked root, read without loading its journal. |
| `PeerInboxMessage` | interface | A message from a SIBLING worker. Information, never instruction — the parent stays the only |
| `PeerMailEnvelope` | interface | One admitted peer message. `threadId` is the root mail's id; `depth` is 0 for a root mail and |
| `PeerMailEvent` | interface | The audit record for one attempt — published whether it delivered or was refused, because a |
| `PeerMailLimits` | interface | Hard bounds. Every one fails closed with a refusal the sender can read. |
| `PeerMailReadout` | interface | What a worker sees when it reads its own mailbox. |
| `Persona` | interface | The "act like X" record. A thin composition over the keystone's `AgentSpec`: it pairs the |
| `PersonaContext` | interface | The persona context blob — who the loop is acting as. Open by intent: a persona names its |
| `PersonaExecutors` | interface | How a persona supplies executor resolution. Either a pre-built registry (factories already |
| `PipelineStage` | interface | `pipeline(stages)` — sequential composition: each stage's `Outcome.deliverable` feeds the next |
| `PrivateCasDurableStore` | interface | Off-host storage that holds a private CAS's bytes after the host deletes its local copy. |
| `PrivateCasNamespaceInventory` | interface | A complete current-object inventory. Callers must fence all namespace writers before retirement. |
| `PrivateCasOffloadReport` | interface | One offload pass: what reached the durable store and what the host still holds. |
| `ProfileRichness` | interface | Per-field verdict on one authored profile — the raw material the bench renders + scores. |
| `ProfileRichnessThresholds` | interface | Thresholds below which a system prompt is treated as a thin stub. Tunable per call. |
| `ProfileRunRecord` | interface | One completed run of one exact profile revision, under its stable NAME. |
| `ProgressView` | interface | The read-model a `StopRule` decides from — the run's progress, not its budget. |
| `PromptHandle` | interface | A versioned reference into a prompt registry: `surface` names the role/edge the text serves, |
| `PromptRegistry` | interface | Versioned prompt store. `resolve` fails loud on an unknown handle: a directive that silently |
| `ProviderAsSandboxClientOptions` | interface | Legacy Sandbox client adapter options. |
| `ProviderCheckpointCaptureContext` | interface | What {@link ProviderWorkspaceRetentionPort.captureCheckpoint} receives. |
| `ProviderExecutorOptions` | interface | Options for running a provider as a supervise-mode executor. |
| `ProviderLeafOut` | interface | Provider execution evidence and default turn output: the visible answer plus the event archive the |
| `ProviderModelAttemptEvidence` | interface | One provider/harness inference attempt. An empty observation list means the attempt started but |
| `ProviderPlacement` | interface | Caller-declared execution placement. Matching never changes the authored profile. |
| `ProviderSeam` | interface | Generic environment provider executor config. External packages implement |
| `ProviderWorkspaceAttemptProvenance` | interface | One Sidecar execution attempt; retries remain separate evidence. |
| `ProviderWorkspaceCaptureProvenance` | interface | Source-reported coverage retained with the verified archive reference. |
| `ProviderWorkspaceCaptureReceipt` | interface | Durable join from one provider box to the verified bytes retained before cleanup. |
| `ProviderWorkspaceEntryMetadata` | interface | Source inventory metadata for a workspace entry. |
| `ProviderWorkspaceRetentionContext` | interface | The exact live execution facts supplied to a retention callback. |
| `ProviderWorkspaceRetentionPort` | interface | The caller-owned boundary used to retain an executable provider workspace. |
| `ProvisionedSupervisor` | interface | Handles for one Runtime-owned supervisor and its first interactive worker. |
| `ProvisionSupervisorConnection` | interface | Caller-supplied environment provider for one supervisor run. |
| `ProvisionSupervisorRequest` | interface | Input to the public Runtime supervisor provisioner. |
| `QuestionEscalationRecord` | interface | The operator-facing artifact written for every `ask_parent`: which question left, whether |
| `ReadableEnvironment` | interface | The two optional environment reads the capture needs. Public because `captureHarnessTranscript` |
| `ReconnectRetainedInteractiveRunOptions` | interface | Reconstruct one exact provider-owned native coding-agent process. |
| `ReconnectRetainedRunOptions` | interface | Inputs sufficient to rebuild a control client in a new process. |
| `RecoverRetainedInteractiveRunOptions` | interface | Recover a start after a pre-create crash or a lost provider response. |
| `RecoverRetainedRunIntentOptions` | interface | Recover a headless start after its pre-create intent was persisted. |
| `RecoverRetainedRunOptions` | interface | Pre-dispatch admission coordinates for one recovery attempt. |
| `RecursiveReservationPolicy` | interface | Optional recursive admission policy. `ownerShare` is the fraction of every manager's budget |
| `ReenteredWorkers` | interface | The workers a resumed scope found open; see {@link ResumedWork.reentered}. |
| `ReentryContinuity` | interface | What the next drive continues, as the drive harness can prove it before the turn starts. |
| `RegisteredPrompt` | interface | One registry entry: the handle plus the text it pins. |
| `RegistryAnalyzeProjection` | interface | Project a `ScopeAnalyzeInput` into the `AnalystRegistry.run` arguments. The registry runs over a |
| `RemoteSupervisorAgent` | interface | Minimal agent identity and topology returned by the protected reader. |
| `RemoteSupervisorControl` | interface | A separate capability for the same manager's owned workers, without manager tool grants. |
| `RemoteSupervisorReader` | interface | The existing coordination transport, restricted to reading the owned tree and worker output. |
| `RemoteSupervisorTree` | interface | Current owned tree, including nested managers and resumed nodes. |
| `RenderCorpusToInstructionsOptions` | interface | Project accreted corpus facts into an `AgentProfile`'s instruction seams — the learning-flywheel |
| `ReservationFloor` | interface | The part of each channel a reservation must leave free: a manager's own share of its slice, |
| `ReservationHolder` | interface | Who holds a reservation, recorded at `reserve` and refined through `attribute`, so a ticket |
| `ReservationShortfall` | interface | One channel a `budget-exhausted` reservation could not fit. A refusal lists every such channel |
| `ReservationTicket` | interface | Opaque, single-use reservation handle returned by `reserve` and consumed by |
| `ReserveOptions` | interface | How a caller asks for a reservation. |
| `ResolvedMcpServerLaunch` | interface | The spawn-ready strings for one stdio MCP server: profile config values |
| `ResolvedWorkerSpawnRetry` | interface | A policy with every bound decided — what {@link retryPreSpawnRefusals} acts on. Produced by |
| `ResourceLimit` | interface | Caller-defined resource ceiling in non-negative safe-integer units, consistent throughout a tree. |
| `ResourceSpend` | interface | Non-negative safe-integer subtotal. False means unknown, even when amount is zero. |
| `ResultBlobStore` | interface | Content-addressed result blobs (the `outRef` → artifact map) backing the replay |
| `ResumedKeyState` | interface | What the journal proves about one keyed assignment at resume time. |
| `ResumedWork` | interface | The committed work a resumed run inherits from its journal. `settled` is the replayed |
| `RetainedHarnessTranscriptDescriptor` | interface | Inventory and source identity only; native bytes remain in the original workspace archive. |
| `RetainedInteractiveEnvironmentAdmission` | interface | Exact interactive start request durable after environment creation. |
| `RetainedInteractiveIntentAdmission` | interface | Sanitized intent durable before an interactive environment create begins. |
| `RetainedInteractiveRunHandle` | interface | Exact interactive process controls plus measured environment capabilities. |
| `RetainedInteractiveStartedAdmission` | interface | Provider-issued interactive process reference durable before start returns. |
| `RetainedInteractiveStartMaterial` | interface | Material used to create and start one native coding-agent TUI. |
| `RetainedRunCancellation` | interface | Durable acknowledgement state for one retained control operation. |
| `RetainedRunCancelOptions` | interface | Options for an idempotent retained cancellation. |
| `RetainedRunDispatchedAdmission` | interface | The verified exact reference, durable before the start promise resolves. |
| `RetainedRunEnvironmentAdmission` | interface | Recovery coordinates durable after environment creation and before dispatch. |
| `RetainedRunEventOptions` | interface | Options for replaying canonical events strictly after a saved point. |
| `RetainedRunHandle` | interface | Reconstructable control of one provider-retained run. |
| `RetainedRunIntentAdmission` | interface | Sanitized headless intent durable before environment creation. |
| `RetainedRunReplayPoint` | interface | Cursor plus runtime sequence needed to continue one ordered replay. |
| `RetainedRunSnapshot` | interface | Stable status snapshot for a retained run. |
| `RetainedRunStartMaterial` | interface | Environment, turn, and optional identity needed to replay one retained start. |
| `RootHandle` | interface | Live root handle — a chat/pi-viz client uses it to inspect and control one root run. |
| `RootSegment` | interface | What a root runs on during one segment of its run. |
| `RootSegmentEntry` | interface | The segment a root enters with this process. |
| `RootStreamReceipt` | interface | The root manager's retained provider stream: `<runDir>/root-stream.jsonl`, one line per |
| `RouteGate` | interface | A vertex that is not an agent: reaching it asks the caller for one of `choices`. The edges |
| `RouterResponseReceipt` | interface | Exact buffered HTTP evidence. Authentication and cookie headers are excluded. |
| `RouterRouting` | interface | Router provider routing, lowered into every request a transport sends as |
| `RouterSeam` | interface | Router/inline transport seam. The profile owns model, prompt, and generation behavior. |
| `RouterToolsSeam` | interface | Router seam WITH tool use — the tool-using router backend. Same direct |
| `RouterTransportConfig` | interface | Connection details for Runtime's Router-backed executors. |
| `RunCancellation` | interface | The durable acknowledgement state for the run-scoped cancel operation, keyed by `operationId`. |
| `RunCancelRequest` | interface | One durable run-scoped cancel request: cancel the WHOLE run, not one worker. |
| `RunContextLease` | interface | An immutable capability for one run ownership generation. |
| `RunGraphOptions` | interface | Options for one `runGraph` run. |
| `RunParkingPolicy` | interface | Release a durable coordinator after it has only waited this long. The caller's keeper owns wakeup. |
| `RunParkingRecord` | interface | The durable handoff from a waiting coordinator to its existing keeper. |
| `RunPersonifiedOptions` | interface | The end-to-end entrypoint. Builds the persona's root `Agent` from the chosen shape, then |
| `RunProvenance` | interface | Domain-free run provenance: a manifest of what was mounted into the run's |
| `RunTraceSources` | interface | What a run's trace is read from: the director's root stream, when it has one, and its workers. |
| `S3PrivateCasStore` | interface | The S3 store also holds small named pointers beside its content-addressed objects. A pointer |
| `S3PrivateCasStoreOptions` | interface | An S3-compatible bucket (Amazon S3, Cloudflare R2) addressed with path-style requests. |
| `SandboxClient` | interface | Minimal sandbox client surface the kernel calls. Satisfied structurally by |
| `SandboxEvent` | interface | SSE event from sandbox streaming. |
| `SandboxEvidenceRetentionPort` | interface | One durable capture before a Sandbox box is removed. |
| `SandboxLeafOut` | interface | Parsed output of one Sandbox executor turn. |
| `SandboxLineage` | interface | Owns box + session handles for one loop run and offers the three |
| `SandboxLineageHandle` | interface | A live box plus the session that threads its iterations together. Handed back |
| `SandboxSeam` | interface | Sandbox executor seam. The `sandboxClient` the composed `runAgentRounds` creates |
| `SandboxServedBackend` | interface | The provider/model the platform reports it actually bound to a turn, when it reports one. |
| `SandboxSteeringOptions` | interface | Opt-in configuration for the steerable sandbox worker (`SandboxSeam.steering`); absent, the single-shot composition is kept. |
| `SandboxToolPartState` | interface | Cross-event state for {@link mapSandboxToolEvent}. Sandbox backends emit a |
| `SandboxUsageLedger` | interface | Per-turn usage accounting over BOTH the canonical events and the harness-native ones. |
| `Scope` | interface | The budget-conserving reactive scope an `Agent.act` runs inside. `spawn` reserves |
| `ScopeAnalyst` | interface | The reactive analyst seam — the PORT of the round-synchronous driver's `analyze` hook |
| `ScopeAnalyzeInput` | interface | Input to a `ScopeAnalyst.analyze` — the root task framing + the children settled so far. |
| `ScopeArgs` | interface | Construction args for `createScope`. The supervisor threads the shared pool, journal, |
| `ScopeProgressInput` | interface | The scope-side facts about a child, independent of whether its executor cooperates. |
| `ScopeWidenGate` | interface | The runtime widening gate (the reactive analogue of the keystone's `WidenGate`, lifted to read |
| `SearchSpec` | interface | One multi-agent research configuration: seven orthogonal axes, all data. |
| `SearchSpecInputs` | interface | Everything a compiled call needs besides the spec: the problem, its bounds, and the call's |
| `SelectionReceipt` | interface | A record of one candidate-selection decision: which iteration the selector |
| `SessionMessageLike` | interface | A harness session message carrying parts (the shape `box.messages()` returns). Structurally typed |
| `SettledWorker` | interface | A worker whose settlement reached the manager's inbox. |
| `ShapeBudget` | interface | Budget knobs a shape reads to size its fanout/children WITHOUT owning the conserved pool. |
| `ShapeContext` | interface | The construction context a `LoopShape` factory receives. Carries the persona's resolved |
| `ShapeRegistry` | interface | The open shape registry — the extension point that makes a new loop-shape ONE file + one |
| `SharedBoxCloseReceipt` | interface | What {@link SharedBoxPlacement.close} did to each box. |
| `SharedBoxPlacement` | interface | A shared-box placement: the provider Runtime uses for a profile the placement accepts. |
| `SharedBoxPlacementOptions` | interface | Options for {@link sharedBoxPlacement}. |
| `SharedBoxStats` | interface | Counts that show how the pool placed its workers. |
| `SharedWorkerIdentity` | interface | Who a shared worker is, for the router rows its model calls leave on the box's key. |
| `SpawnForest` | interface | Complete cold-readable view of one recursive supervision run. |
| `SpawnForestEvent` | interface | One event with the journal tree that establishes its cursor namespace. |
| `SpawnForestInDoubtNode` | interface | A spawned worker with no terminal record in a cold snapshot. Resume treats the same state as |
| `SpawnForestMissingTree` | interface | A driver spawn whose owned journal tree was never begun before the process stopped. |
| `SpawnForestNode` | interface | One flattened node with the journal tree that owns its records. |
| `SpawnForestTree` | interface | One journal tree in a recursively loaded supervision forest. |
| `SpawnJournal` | interface | The spawn-tree event source (begin/append/load). |
| `SpawnModelSubstitution` | interface | A spawn whose authorized profile names another harness/provider/model route than the parent |
| `Spend` | interface | Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd are separate |
| `SpendGap` | interface | One journaled node whose usage accounting is incomplete — the named gap behind a `false` |
| `SqlAdapter` | interface | Minimal SQL driver shape. Implementations forward to whichever client the |
| `StartRetainedInteractiveRunOptions` | interface | Start one retry-safe native coding-agent TUI in a new environment. |
| `StartRetainedRunInEnvironmentOptions` | interface | A fresh retained session inside a provider environment that already exists. |
| `StartRetainedRunOptions` | interface | A retained start is retry-safe only when environment and turn keys are explicit. |
| `SteerableRootHandle` | interface | A Runtime-minted root handle that can deliver raw steering or answers to a live manager inbox. |
| `SteerableSandboxSession` | interface | What the steerable session exposes to its executor: the usage stream plus the live reads. |
| `SteerContext` | interface | How a combinator's `act` consumes findings to steer — the SINGLE firewalled steer surface a |
| `StrategyArtifacts` | interface | Artifact lifecycle a strategy may manage itself — open/close ONLY. Raw `call`/`score` |
| `StrategyCtx` | interface | What a strategy body composes with: the artifact lifecycle, the budget, and the two steps. |
| `StrategyShotResult` | interface | Measured result of one strategy shot. |
| `StrategyTournament` | interface | Every settled cell of one split, by task and strategy. Strategies measured on different |
| `StructuralRolloutPolicy` | interface | The rollout's compute recipe — promoted from the proven rigs' env vars (K/REPAIRS/ |
| `StructuralRolloutResult` | interface | The body's deliverable — a `StrategyResult` plus selection provenance. The extra |
| `SubtreeResult` | interface | One direct child of a manager, as its lead sees it in a {@link SubtreeSummary}. |
| `SubtreeSummary` | interface | A bounded account of the team a manager led, carried up on its settlement. |
| `SuperviseDispatchOptions` | interface | Adapt a recursive Runtime `supervise()` tree to one Agent Eval profile-matrix cell. |
| `SuperviseProfileEntry` | interface | One entry of a run's profiles table (`SuperviseRegistry.profiles`): the exact profile a manager |
| `SuperviseRegistry` | interface | The name→value tables that make the three CODE-valued options expressible as run DATA, and the |
| `SuperviseRegistryTable` | interface | A name→value table in this package's resolver-port shape: construction stays the caller's, |
| `Supervisor` | interface | Owns the conserved pool, the spawn log, the abort cascade, the OTP intensity breaker, |
| `SupervisorCleanupReceipt` | interface | Exact owner-scoped cleanup receipt returned after Runtime releases the run resources. |
| `SupervisorNodeContext` | interface | Trusted run/node identity Runtime binds to one manager. Model-authored tool arguments cannot |
| `SupervisorSpanOutcome` | interface | How the supervised run ended, as `finish()` records it on the root span. |
| `SupervisorToolDescriptor` | interface | One product-owned tool. It reuses the canonical MCP descriptor fields while Runtime supplies |
| `SupervisorToolInvocationContext` | interface | Trusted context for one product-tool invocation. The node identity remains the same detached, |
| `SurfaceDiff` | interface | One watched surface whose settled state differs from what was mounted (or from absence). |
| `SurfaceReadBox` | interface | The minimal box surface the box-backed reader needs — structurally typed so the real |
| `TaskQueueEntry` | interface | One identified task admitted by a caller-owned ready queue. |
| `TeamProgress` | interface | The team a worker leads, as its own lead observes it mid-flight: every agent below the worker, |
| `ToolLoopCallContext` | interface | Runtime-owned identity and cancellation for one logical inference call. The wrapper is frozen |
| `ToolLoopCompaction` | interface | Self-compaction — bound the loop's OWN context window the way a fresh-respawn (dumb-Ralph) loop |
| `ToolLoopToolCall` | interface | One provider-neutral tool request emitted by a tool-loop model. |
| `ToolOutcomeEvent` | interface | A tool call that outlived its response fence, and its outcome once it settled. |
| `TournamentCell` | interface | One strategy on one task at one repeat: the settled cell's final attempt. |
| `TraceRootArtifact` | interface | The stored trace-root artifact. `leaves[i]` and `salts[i]` belong to `events[i]` of the |
| `TraceRootReceipt` | interface | The Merkle root over the events an output archived, as a journal record carries it beside that |
| `TraceSummary` | interface | The last leaf of a trace root: how many events the archive holds and the tool calls among them, |
| `TrajectoryNode` | interface | One node in the reconstructed trajectory tree — a driver OR a leaf, with its OWN spend and the |
| `TrajectoryReport` | interface | The whole reconstructed trajectory — the realized tree + its root-rolled-up total. The |
| `TrajectoryReportOptions` | interface | `trajectoryReport(journal, blobs, root, { withOutputs? })` — reconstruct the whole tree with |
| `TreeView` | interface | The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer. |
| `TurnResult` | interface | One finished turn over the artifact. A failed FS read is surfaced in `readError` |
| `UnavailablePausePolicy` | interface | How long an agent waits after its upstream refused a turn for capacity: the codes and |
| `UnconfirmedTeardown` | interface | One settled child whose executor teardown was never acknowledged: the run cannot prove the |
| `VerifySpec` | interface | `verify({ implement, verifier })` — the 2-node sequential gate: an IMPLEMENT child produces a |
| `VisibleCheck` | interface | One task-visible executable check (e.g. a single-line Python assert). |
| `WatchedSurface` | interface | A path to check at settle that was NOT necessarily mounted — where a harness is known to write |
| `WidenGate` | interface | The progressive-widening gate (MCTS-PW). Decides whether a settled child is |
| `WidenLineage` | interface | A lineage the gate may widen toward — the settled child that looked promising + the findings |
| `WidenSpec` | interface | `widen({ gate })` (G5) — the STREAMING spawn-on-completion driver. Unlike the static-fanout |
| `WorkerCancellation` | interface | The durable acknowledgement state for one worker-scoped cancel operation, keyed by |
| `WorkerEventCursor` | interface | Live observation is bounded and process-local. A reconnect explicitly reports expired history. |
| `WorkerProgress` | interface | The full live view of one worker, as `observe_agent` returns it mid-flight. |
| `WorkerResumeContext` | interface | The resume lineage a `'resume'` spawn hands the executor seam |
| `WorkerSpawnContext` | interface | Immutable task, allocation, identity attribution, and semantic key supplied while a manager's |
| `WorkerSpawnRetryAttempt` | interface | One re-entry, reported before it waits. |
| `WorkerSpawnRetryPolicy` | interface | How hard a pre-spawn worker refusal is re-entered. Absent from `supervise` means NO retry — the |
| `WorkerSteerAcknowledgement` | interface | Runtime acknowledgement for one exact steer operation. |
| `WorkerSteerRequest` | interface | One atomically admitted down-leg request for an exact worker id. |
| `WorkerToolTraceArtifact` | interface | Bytes stored under `WorkerTraceEvidence.traceRef`. |
| `WorkspaceCheckpointMarker` | interface | The file Runtime writes into a retained owner's workspace immediately before a checkpoint, and |
| `WorktreeCommandResult` | interface | Outcome of one verification command run in the worktree (test or typecheck). |
| `WorktreeHarnessResult` | interface | The canonical result of one worktree-harness run, projected by each port to its own shape. |
| `WorktreeProfileMaterializationReceipt` | interface | Proof of the profile inputs delivered before the worker process started. |
| `WriteWorkerSteerOptions` | interface | Caller input for one retry-safe steer operation. |
| `AgentTurnBackend` | type | The execution substrate one turn runs on — a closed discriminated union over |
| `AnalystLensOutput` | type | What one analyst lens may return. |
| `AssertTraceDerivedFindings` | type | The firewall assertion contract, re-stated for the reactive seam (PORT of |
| `AuthoredProfile` | type | What the supervisor AUTHORS per sub-task: one complete canonical profile whose name and |
| `AxisScoresOf` | type | Decompose ONE record into per-axis scores (e.g. judge dimensions). When set, it REPLACES the |
| `BudgetReadout` | type | Post-reservation pool readout — the shape `Scope.budget` exposes. `deadlineMs` is the ABSOLUTE |
| `ChatCompletionsTransport` | type | Buffered OpenAI-compatible completion port used only for offline execution. |
| `CodexForkBoundary` | type | How this reader isolated the session's own rows from the parent rows prepended to its file. |
| `CombinatorShape` | type | A combinator is just a `LoopShape`: a factory `(ShapeContext) => Agent` whose `Agent.act` |
| `CompiledSearchSpec` | type | The one call a spec compiles to, with every option inspectable before spend. |
| `ContinuationAppend` | type | A play's own section for one note. Return `undefined` to add nothing this time. |
| `ContinuationPanel` | type | Ask the panel's questions over the run's own traces. |
| `CoordinationEvent` | type | Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for |
| `DeclaredCheckStateCapture` | type | Write the run's state into `into`, an empty directory Runtime created and removes after the read. |
| `DefinePersona` | type | Builds a frozen `Persona`, failing loud on the executors-supplied invariant (neither a |
| `Deliverable` | type | How a typed deliverable `Out` is materialized from a finished turn. |
| `DispatchStopReason` | type | Why the dispatcher stopped admitting work. `drained` = the queue ran dry (the ordinary end); |
| `DownMessageDeliveryOutcome` | type | The exact result of one parent→child delivery attempt. |
| `DriverAttemptStop` | type | Why the retry loop stopped. `completed` is the only non-failure. |
| `DriverContractState` | type | Whether the declared completion check has passed; `'none'` means the caller declared no check. |
| `DriverFailureClass` | type | How one driver failure is answered. |
| `DriverReentry` | type | Why the loop is entering the driver again (absent on the first attempt only). An `unmet-contract` |
| `DriverRepromptRefusal` | type | Why a completed drive with an unmet contract was not re-entered. `closed` means the run was |
| `EdgeDeliveryOutcome` | type | `failed` is a maps item or join that ran and settled without a usable result (down, or |
| `Environment` | type | A checkable task domain — implement these 5 hooks and the suite does the rest. The |
| `ExecutionBindingReceipt` | type | One attempt's immutable link from a stable materialization plan to its actual transport. |
| `ExecutorConfig` | type | Config for {@link createExecutor}: the backend is DATA — the cost dial a profile, |
| `ExecutorFactory` | type | Builds a fresh `Executor` for one spawn from the resolved, immutable spec. Per-spawn (not shared) |
| `ExecutorProgressEvent` | type | Live output observed while an executor runs, in Runtime's own vocabulary. It carries what the |
| `FanoutWinnerSelector` | type | A winner-selection strategy: argmax/sort over the gathered child iterations (each output is the |
| `GateDecision` | type | The caller's answer to one gate visit: route on a choice, or end the run. `by` names who |
| `GitRunner` | type | Pluggable git runner (sync) — replaceable in tests. |
| `GroupOf` | type | The axis (matrix column) a record contributes to — default the scenario group. |
| `HarnessTranscriptCapture` | type | What the executor holds before settlement: a retained descriptor, inline files, or absence. |
| `HarnessTranscriptEvidence` | type | The durable receipt on a settlement: a content-addressed pointer to a persisted |
| `HarnessTranscriptUnavailableReason` | type | Why no transcript reached a record, from either the capture or the settle path. |
| `HeldRelease` | type | Why a held budget-stop environment was released: its hold ceiling ran out, its manager |
| `InProcessOnPrompt` | type | The user callback: given a prompt and its round, produce the box's event |
| `InteractiveWorkerEnvironment` | type | Environment fields supplied to every interactive worker after Runtime adds the exact profile. |
| `JsonScalar` | type | A JSON scalar: what a route condition compares. A numeric or stateful rule is a field the |
| `LoopOptionsForDispatch` | type | runAgentRounds options minus the `ctx` (loopDispatch builds the ctx). |
| `LoopShape` | type | A reusable act-body factory. Given the persona's content + seams (`ShapeContext`), it |
| `MapItemFailurePolicy` | type | What a map does when one of its items fails. See {@link MapOnSettleRoute.onItemFailure}. |
| `MaterializedModelIdentity` | type | A named model carried into an execution, or an explicit reason the exact model is unknowable. |
| `MountRecorder` | type | Records a mounted resource into the run's provenance manifest. Passed to |
| `NativeContextContinuationExecution` | type | Result of one verified same-session continuation. |
| `NativeContextContinuationInput` | type | Runtime controls plus the exact user turn bound into a continuation request. |
| `NodeId` | type | Deterministic node id — `${parent}:s${seq}` from the cursor order, never wall-clock. |
| `NodeStatus` | type | `'queued'` is an admitted child that holds its budget slice and waits for a worker slot |
| `ObservationAnalysis` | type | A caller-selected analysis retains the same findings, usage, and corpus contract. |
| `ObserveSupervisorNodeEvent` | type | Context-aware observer used internally to bind product transactions to the actual live node. |
| `OpenSandboxRunPromptOptions` | type | Prompt options forwarded to every sandbox prompt turn in this run. The |
| `Outcome` | type | The terminal contract: a loop returns a FINISHED deliverable, or the concrete |
| `Panel` | type | `panel(spec)` — build the M-judge write-only-merge combinator. |
| `PeerMailRefusal` | type | Why an attempt did not reach a sibling. Each value is a fact the sender can read and act on. |
| `ProfileKeyOf` | type | The profile (matrix row) a record belongs to — default `harness·model` from the record's profile cell, |
| `ProfileMaterializationReceipt` | type | What the kernel can prove about one node's actual execution plan. |
| `ProviderModelExecutionEvidence` | type | Durable provider identity evidence, independent from the planned materialization alias. |
| `ProviderNativeCapturePhase` | type | When {@link ProviderWorkspaceRetentionPort.captureNative} runs relative to its turn. |
| `ProviderPromptOptions` | type | Per-run Sandbox prompt options for the provider path — the same field, the same name, and the |
| `RecoverRetainedRunResult` | type | Outcome of one recovery attempt. |
| `RemoteSupervisorSteerResult` | type | Actual handler outcomes; queue admission never stands in for delivered steering. |
| `RemoteWorkerEvents` | type | The same bounded event page served by Scope's live observation owner. |
| `ReservationRejection` | type | Why a reservation was refused. `usd-unbudgeted`: the root declared no dollar ceiling, so the |
| `ReservationStage` | type | Where in the spawn lifecycle a reservation was last seen. `admitted` is the window between |
| `ResolveSupervisorTools` | type | Product policy for the tools one exact supervisor node may call. Resolved once per node. |
| `RetainedExecutionState` | type | The recorded fate of a child whose provider execution was RETAINED: admitted durably, with no |
| `RetainedInteractiveAdmission` | type | Durable records for one exact native coding-agent process. |
| `RetainedInteractiveAdmissionHook` | type | Persist each exact interactive record before the runtime proceeds. |
| `RetainedInteractiveEnvironmentInput` | type | Environment and exact AgentProfile used to start one native coding-agent process. |
| `RetainedRunAdmission` | type | One detached-run admission record the runtime persists before creation or dispatch proceeds. |
| `RetainedRunAdmissionHook` | type | Awaited durability hook for retained admission records. |
| `RetainedRunEffect` | type | Effect recorded for one retained control operation. |
| `RetainedRunTurnInput` | type | A fresh retained turn with a canonical, approved portable context request. |
| `RootMaterialization` | type | Trusted root composition evidence. Generic `Agent.act` roots omit this and remain unknown. |
| `RootProviderModelEvidence` | type | Provider-observed model identity for the root manager's settled inference turns. |
| `RootSignal` | type | Cancellation of a running root. Send steering or answers through the root's `deliver` inbox. |
| `RouteMatch` | type | One condition over a settled result: the RFC 6901 `pointer` in the latest usable result of |
| `RouteWhen` | type | A route condition: one match, or every match of `all`. |
| `RunContext` | type | The stores a supervised run needs, in-memory or file-backed. `InMemoryRunContext` is the |
| `RunPersonified` | type | The composed run signature. |
| `Runtime` | type | The runtime tag of a `Executor` impl. Open by intent: custom runtimes use their own string name. |
| `SandboxOutputMarker` | type | What a settled turn produced, as an explicit marker. |
| `ScoreOf` | type | Pull the headline score in [0,1] from a record. Default: the held-out split, else the search split, |
| `SearchSpecOwnedOption` | type | A `SuperviseOptions` key that an axis or a typed input decides. |
| `SeatStage` | type | A stage is authored in the immutable profile. A selection is a concrete, private placement. |
| `Settled` | type | A settled child, delivered by `scope.next()`. `seq` is the monotonic cursor order |
| `Shell` | type | Command runner seam. Host code can use `localShell`; sandbox code can wrap `box.exec`. |
| `SpawnPrior` | type | What a KEYED spawn resolved to when the key had a prior attempt. Absent on a fresh key (and on |
| `SpawnRejection` | type | Fail-closed spawn rejections: an exhausted pool, a dollar request against a root that budgets |
| `SpendChannel` | type | The accounting channels a usage gap leaves incomplete. |
| `StopDecision` | type | A stop rule's answer. `reason` is required when stopping — a run that ends must be able to say |
| `StopRule` | type | Evaluated from the progress feed, never from the budget. Pure and synchronous: it is called on |
| `StoredGraph` | type | A graph as stored. Observed imports retain unknown directives and budgets; |
| `StoredGraphInput` | type | Editable graph data; registration computes its digest when it is omitted. |
| `StrategyMessage` | type | One provider-neutral conversation record carried between strategy shots. |
| `StructuralRolloutMessage` | type | Provider-neutral conversation records read by structural candidate extraction. |
| `SupervisedResult` | type | Typed terminal result (M2) — a no-winner is NEVER coerced to a best-effort output. |
| `SuperviseOptionsForDispatch` | type | `supervise` options minus Eval-owned cancellation. |
| `SupervisorFinalizer` | type | The finalization seam: ledger in, output (or `undefined` = nothing deliverable) out. |
| `SupervisorNodeContextSeed` | type | Context known before `Agent.act`; Runtime adds the concrete node, profile, and task. |
| `SupervisorProfile` | type | A supervisor is an exact canonical AgentProfile; no looser model/prompt shape exists. |
| `SupervisorSpanAttributes` | type | OTLP span attribute values; exported because `SupervisorSpanOptions.attributes` is public. |
| `SurfaceReader` | type | The read seam: fetch the current bytes at a mounted path. Implemented by a sandbox box's |
| `SurfaceReadOutcome` | type | Outcome of reading one surface back at settle. `missing: true` means the path no longer exists |
| `TaskQueueSettlement` | type | Native promise settlement, retaining the exact returned or thrown value. |
| `TerminalDecision` | type | One of the kernel's terminal decision values. |
| `TokenUsageProvenance` | type | How a token count was obtained. |
| `ToolLoopChat` | type | One inference turn over the running conversation + the tool specs → the model's text, any |
| `ToolLoopMessageRecord` | type | Provider-neutral conversation record accepted by a tool-loop brain. |
| `TraversalContinuity` | type | How one ledgered hop CONTINUED: a spawn traversal stamps its effective spawn mode |
| `UnknownMaterializationReason` | type | Why exact materialization evidence is unavailable for a node. |
| `Verify` | type | `verify(spec)` — build the 2-node implement→verifier-gate combinator. |
| `Widen` | type | `widen(spec)` — build the streaming progressive-widening combinator. |
| `WidenDecision` | type | A widening decision: extend one lineage by one child, or stop widening. `flatWidenGate` |
| `WinnerStrategy` | type | Built-in valid-only winner strategies for `selectValidWinner` (selector≠judge): best gated-valid |
| `WorkerInteractiveBinding` | type | Durable exact-process binding or capability decision for one supervised worker. |
| `WorkerInteractiveProviderSource` | type | Provider lookup accepted by {@link attachWorker}. |
| `WorkerInteractiveSession` | type | One worker's attachable process, or the named reason there is none. |
| `WorkerInteractiveUnavailableReason` | type | Why Runtime cannot hand a caller the exact interactive process one worker runs in. |
| `WorkerTraceEvidence` | type | Durable proof of a worker's structured tool trace, or the exact reason it is unavailable. |
| `WorkerTraceResolver` | type | Resolve the trace context a worker spawned BY `spawningNodeId` should inherit. `undefined` means |
| `WorkerTraceUnavailableReason` | type | Why Runtime cannot provide structured tool-call evidence for one settled execution. |
| `WorktreeCheckRunner` | type | The single shell-command-in-worktree runner seam (replaces the per-executor copies). |
| `WorktreePatchArtifact` | type | Terminal artifact of one worktree-CLI run — the canonical worktree-harness result (the captured |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AcquireOptions`, `AgentCandidateWorkspaceArchiveLimits`, `AgentEnvironment`, `AgentEnvironmentCapabilities`, `AgentEnvironmentEvent`, `AgentEnvironmentProvider`, `AgentEnvironmentQuery`, `AgentEnvironmentSummary`, `AgentGraph`, `AgenticOptions`, `AgenticRunResult`, `AgenticTask`, `AgenticTool`, `AgentSession`, `AgentSessionRef`, `AgentTurnInput`, `AgentTurnResult`, `AllWorkersStalledOptions`, `AnalystRegistry`, `AnytimeReport`, `AnytimeStrategySummary`, `AnytimeTaskCurve`, `ArtifactHandle`, `AuthoredHarness`, `AuthoredStrategy`, `AuthorStrategyOptions`, `BenchmarkConfig`, `BenchmarkLift`, `BenchmarkStrategySummary`, `BenchmarkTaskRow`, `BoundHarnessSession`, `BudgetPool`, `BusStats`, `CheckpointRef`, `CheckpointRequest`, `CheckRunContext`, `CliWorktreeBridgeSeam`, `CodeModeTool`, `CodeModeToolContext`, `CodeModeToolset`, `ContinuationPanelResult`, `CoordinationMcpHandle`, `CopyOptions`, `CorpusReadbackOptions`, `CreateAgentEnvironmentInput`, `DefinedLeaderboard`, `DesignerToolsEnv`, `DispatchReport`, `Driver`, `EvolutionAuthor`, `EvolutionReport`, `ExecRequest`, `ExecResult`, `ExecutorResultMapping`, `ForkRequest`, `GitWorkspaceOptions`, `GraphDesignerExtraTools`, `GraphFromStoredOptions`, `GraphRegistryDir`, `GraphResult`, `HarnessFileBinding`, `HarnessTranscriptArtifact`, `HarnessTranscriptBinding`, `HarnessTranscriptFile`, `HarnessTranscriptMetadata`, `HarnessTranscriptReadOptions`, `HarnessTranscriptUnavailable`, `HarvestFailure`, `HarvestReport`, `HttpMcpServerSpec`, `Inbox`, `InPlaceCliExecutorOptions`, `InProcessSandboxClientOptions`, `IsolatedCheckOptions`, `Iteration`, `Leaderboard`, `LeaderboardOptions`, `LoadedGraphFile`, `LoadGraphFileOptions`, `LocalHarnessResult`, `LocalSandboxClientOptions`, `LoopDecisionPayload`, `LoopDispatchOptions`, `LoopEndedPayload`, `LoopIterationEndedPayload`, `LoopIterationStartedPayload`, `LoopPlanDescription`, `LoopResult`, `LoopSandboxPlacement`, `LoopStartedPayload`, `LoopTraceEmitter`, `LoopWinner`, `MaterializeLocalMcpOptions`, `McpEnvironmentOptions`, `McpListedTool`, `NodeSnapshot`, `NoProgressForOptions`, `Observation`, `ObserveInput`, `OpenSandboxRunOptions`, `PairwiseOptions`, `PeerMailbox`, `PeerMailboxOptions`, `PeerMailSendInput`, `PlacementInfo`, `PlateauOptions`, `PrivateCasArtifactPort`, `PrivateCasNamespaceObject`, `PrivateCasNamespaceRetirement`, `PrivateCasOptions`, `ProfileRegistryDir`, `ProviderWorkspaceCaptureResult`, `PublishOptions`, `QuestionRecord`, `ReentryTaskInput`, `ResolveSandboxClientOptions`, `ResourceRequest`, `RetainedHarnessTranscriptCapture`, `RollingDispatchOptions`, `RunAgenticOptions`, `RunAgentRoundsOptions`, `RunCodeModeOptions`, `SandboxEvidenceContext`, `SandboxEvidenceReceipt`, `SandboxRun`, `SeatSegment`, `ShotSpec`, `SpawnOpts`, `SqlRunContextOptions`, `StdioMcpConnection`, `StdioMcpServerSpec`, `SteerableSandboxArgs`, `Strategy`, `StrategyEvolutionConfig`, `StrategyResult`, `StreamAgentTurnOptions`, `StructuralRolloutConfig`, `SuperviseOptions`, `SupervisorAgentDeps`, `SupervisorOpts`, `SupervisorSpanOptions`, `SupervisorSpanRecorder`, `SurfaceScore`, `TaskQueueOptions`, `ToolSpec`, `ToolStepInput`, `TournamentRow`, `TraceSource`, `TrajectoryAnalysis`, `UntrackedCopyStats`, `ValidateStoredGraphOptions`, `ValidationCtx`, `Validator`, `VerdictSummary`, `VerifierEnvironmentOptions`, `WatchTraceOptions`, `WaterfallCollector`, `WaterfallReport`, `WaterfallSpan`, `WorkerEventEntry`, `WorkerEvidenceInput`, `WorkerSpawnRetryHooks`, `Workspace`, `WorkspaceRequest`, `WorkspaceRun`, `WorktreeCliExecutorOptions`, `WorktreeFanoutOptions`, `AgentEnvironmentStatus`, `AgentSessionStatus`, `CodeModeStore`, `GraphEdge`, `GraphFileSeat`, `GraphSelection`, `GraphTriggerBinding`, `HarvestCorpusOptions`, `InboxMessage`, `IsolatedCheckResult`, `LoopTraceEvent`, `MakeWorkerAgent`, `ObserveOptions`, `PeerMailOutcome`, `QuestionDecision`, `QuestionEscalationTarget`, `QuestionPolicy`, `RemoteSupervisorCancelResult`, `RepairStop`, `SpawnEvent`, `UsageEvent`, `WorkerEventPage`, `WorkspaceCommit`.

### Analyst loop — trace findings on a running loop

Import from `@tangle-network/agent-runtime/analyst-loop` — 12 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `runAnalystLoop` | function | Analyze a run and apply accepted knowledge and agent-surface proposals. |
| `AnalystRegistryLike` | interface | Narrowed shape we accept for `AnalystRegistry` so the orchestrator |
| `FindingsStoreLike` | interface | Narrowed shape we accept for `FindingsStore`. |
| `ImprovementProposalSource` | interface | Agent-surface bridge — proposes prompt, skill, tool, and scaffolding edits. |
| `KnowledgeProposalSource` | interface | Knowledge-side bridge — consumers wire `proposeFromFindings` from agent-knowledge. |
| `AnalystLoopEvent` | type | Events emitted by `runAnalystLoop` via `opts.onEvent`. UIs and |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `ImprovementEditBatch`, `ImprovementReport`, `KnowledgeProposalBatch`, `KnowledgeReport`, `RunAnalystLoopOpts`, `RunAnalystLoopResult`.

### Built-in agent profiles

Import from `@tangle-network/agent-runtime/profiles` — 24 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `buildAuditorSystemPrompt` | function | Build a system prompt for a single auditor iteration. |
| `graphDesignerProfile` | function | Compose graph design capabilities onto a complete execution profile; the skills remain |
| `graphDesignerSkills` | function | Read this installation's bundled skills without depending on a user's skill installation. |
| `parseAuditorEvents` | function | Parse raw `SandboxEvent` emissions from an audit iteration into structured `UiAuditOutput`. |
| `researcherProfile` | function | Build a source-grounded researcher profile with output parsing and validation. |
| `graphDesignerSkillSources` | const | Canonical owners of the separately bundled designer capabilities. |
| `LENS_BRIEFS` | const | Per-lens auditor briefs: concrete signals to look for and cross-lens distinctions to respect. |
| `SHARED_AUDITOR_RULES` | const | Cross-lens rules injected into every UI audit iteration: finding quality standards and scope limits. |
| `KnowledgeItem` | interface | Knowledge item emitted by the researcher. |
| `ResearcherProfileOptions` | interface | Options for the source-grounded researcher profile preset. |
| `ResearchOutput` | interface | Researcher output. Required fields are typed; optional fields preserve |
| `ResearchTask` | interface | Task contract for a source-grounded research agent. |
| `UiAuditOutput` | interface | Output of one iteration. `findings` is the headline payload; `captures` |
| `UiAuditTask` | interface | One iteration's task: audit a single (lens × route) pair, capturing the |
| `UiFinding` | interface | A single UI audit finding — the unit of work a contributor can act on. |
| `UiFindingScreenshot` | interface | Pointer to a screenshot referenced by a finding (workspace-relative path). |
| `KnowledgeUpdate` | type | A proposed write to the knowledge base. The profile does NOT apply |
| `ResearchSource` | type | Source families a researcher profile may prefer for a task. One owner: the delegation |
| `UiFindingSeverity` | type | Severity scale. |
| `UiLens` | type | Canonical audit lenses. Each lens scopes a finding to a single class of |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `GraphDesignerProfileOptions`, `UiAuditCapture`, `UiAuditCaptureRequest`, `UiAuditViewport`.

### Platform glue

Import from `@tangle-network/agent-runtime/platform` — 28 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `createPkcePair` | function | Create an RFC 7636 verifier and its S256 challenge with Web Crypto. |
| `PlatformAuthClient` | class | HTTP client for the Tangle Platform SSO: builds authorize URLs and exchanges auth codes for API keys. |
| `PlatformAuthError` | class | Thrown when a `PlatformAuthClient` request returns a non-success status. |
| `PlatformHubClient` | class | HTTP client for the Tangle Platform Hub API: provider catalog, connection flow, and status. |
| `PlatformHubError` | class | Thrown when a `PlatformHubClient` request returns a non-success status. |
| `PlatformOidcClient` | class | OIDC code + PKCE, refresh/revoke and discovery-bound RFC 8628 device grants. |
| `HealthCheck` | interface | Last-known health for a connection, derived from the connection row. |
| `OidcDeviceAuthorization` | interface | Keep deviceCode secret. Only userCode and the verification URLs are displayed. |
| `PlatformAuthClientOptions` | interface | Server-side client for the Tangle platform's cross-site SSO bridge. |
| `PlatformCatalogProvider` | interface | A connectable provider in the catalog (`/v1/hub/providers`). |
| `PlatformConnection` | interface | A live integration connection, as returned by `/v1/hub/connections`. |
| `PlatformHubClientOptions` | interface | Server-side client for the Tangle platform's integration hub |
| `PlatformOidcClientOptions` | interface | OpenID Connect client for the Tangle authorization server. Identity tokens |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AuthorizeUrlOptions`, `CatalogResult`, `ConnectionHealth`, `ConnectionHealthResult`, `ExchangeCodeResult`, `ExecInput`, `MintTokenInput`, `MintTokenResult`, `OidcAuthorizeUrlOptions`, `OidcExchangeResult`, `OidcTokens`, `OidcUser`, `PlatformHubStatus`, `StartAuthInput`, `StartAuthResult`.

### Candidate execution — immutable prepare, run, grade, and receipt

Import from `@tangle-network/agent-runtime/candidate-execution` — 118 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `agentCandidateProfileAsAgentProfile` | function | Convert the candidate profile contract into the portable interface profile it represents. |
| `applyExactAgentProfileDiff` | function | Apply one exact diff and reject any value that cannot be preserved canonically. |
| `assertCandidateProfileBinding` | function | Prove the measured generic profile and sealed candidate profile describe the same behavior. |
| `buildAgentCandidateBundle` | function | Compile one measured profile/code candidate into the immutable execution |
| `candidateWorkspaceManifest` | function | Build the canonical manifest for files a caller already holds — the shape a remote executor |
| `captureAgentCandidateWorkspace` | function | Capture one exact regular-file workspace for immutable candidate execution. |
| `captureAgentCandidateWorkspaceFiles` | function | Capture detached files returned by a remote executor into the standard archive. |
| `captureAgentCandidateWorkspaceToArtifacts` | function | Capture regular files to durable artifacts with memory bounded by the manifest and stream buffers. |
| `captureAgentCandidateWorkspaceTreeToArtifacts` | function | Store a workspace as a tree: each regular file the store does not already hold, then the |
| `captureAgentWorkspaceSnapshot` | function | Capture through the canonical archive owner and return references only. |
| `createAgentCandidateWorkspacePort` | function | Create the standard bounded materializer for candidate execution ports. |
| `createProtectedAgentCandidateModelPort` | function | Bind a protected model-grant service to the immutable candidate runtime. |
| `disposePreparedAgentCandidateExecution` | function | Revoke reservations held by a prepared candidate that will not be executed. |
| `exactProcessProviderAsCandidateExecutor` | function | Adapt one neutral exact-process provider to Runtime's trusted candidate boundary. |
| `executePreparedAgentCandidate` | function | Executes and finalizes one durably claimed candidate without exposing an unproven result. |
| `freezeGenericAgentCandidateProfile` | function | Convert only behavior-preserving generic profile fields into the closed candidate contract. |
| `materializeAgentCandidateWorkspaceFromArtifacts` | function | Restore regular files into an empty destination after complete verification; paths selects a subset. |
| `materializeAgentWorkspaceSnapshot` | function | Restore canonical workspace references before an agent starts. |
| `parseExactAgentProfileDiff` | function | Parse a profile diff without silently discarding unsupported fields. |
| `prepareAgentCandidateExecution` | function | Materializes a verified candidate into one immutable evaluator-owned execution plan. |
| `readAgentCandidateWorkspaceArtifactFiles` | function | Read selected files only after the existing verifier has accepted the entire archive. |
| `runProtectedAgentCandidateModelGrant` | function | Run one bounded unit under a protected model grant. |
| `sealAgentCandidateBundle` | function | Validate and content-address a candidate bundle before it crosses an approval boundary. |
| `verifyAgentCandidateBundle` | function | Verifies every digest, resource, workspace, and Git object in a candidate bundle. |
| `verifyAgentCandidateWorkspaceArtifacts` | function | Verify durable regular-file workspace evidence without retaining archive or file contents. |
| `verifyAgentCandidateWorkspaceTree` | function | Read a tree back by its digest and confirm the store holds every file it names. Returns the |
| `FileAgentCandidateExecutionClaimStore` | class | Cross-process lifecycle implemented as fsynced, create-if-absent records. |
| `AgentCandidateArtifactPort` | interface | Reads one content-addressed object from the closed S3/IPFS locator set. |
| `AgentCandidateBenchmarkGraderPort` | interface | Evaluator-owned executable grader, pinned by immutable implementation bytes. |
| `AgentCandidateCodeSurfaceSource` | interface | The only accepted path from an agent-eval code candidate to executable bytes. |
| `AgentCandidateExecutionAttemptRecord` | interface | Persisted state available to a fresh trusted recovery worker after a crash. |
| `AgentCandidateExecutionClaim` | interface | Immutable signed identity stored for one execution attempt. |
| `AgentCandidateExecutionClaimStore` | interface | Atomic one-shot store for candidate execution attempts. |
| `AgentCandidateExecutionCleanupHandles` | interface | Non-secret identities a trusted recovery worker needs to close an abandoned attempt. |
| `AgentCandidateExecutionLease` | interface | Secret capability required to finish the acquired attempt. |
| `AgentCandidateExecutionRecoveryEvidence` | interface | Trusted, independently observed closure facts for one expired winning lease. |
| `AgentCandidateExecutionRoots` | interface | Absolute container roots owned by one isolated candidate execution. |
| `AgentCandidateExecutorFinalCapture` | interface | Replayable evaluator result captured only after process death and trace drain. |
| `AgentCandidateExecutorMemoryCapture` | interface | Raw isolated-memory capture made only after access has been revoked. |
| `AgentCandidateExecutorPort` | interface | Executes one prepared request inside an evaluator-owned isolation boundary. |
| `AgentCandidateExecutorProfileFile` | interface | One exact profile file supplied to an evaluator-owned executor. |
| `AgentCandidateExecutorRequest` | interface | One detached request passed to the trusted environment-specific executor. |
| `AgentCandidateExecutorStopRequest` | interface | Opaque process identity used for termination without re-exposing launch credentials. |
| `AgentCandidateModelGrantClient` | interface | Narrow transport contract for a service that owns scoped model credentials |
| `AgentCandidateOutputArtifactPort` | interface | Durable content-addressed evidence store controlled only by the evaluator. |
| `AgentCandidateRepositoryPort` | interface | Resolves a declared GitHub repository to an already-present local Git object store. |
| `AgentCandidateTaskExecution` | interface | Runtime placement for one exact cell from a signed candidate experiment. |
| `AgentCandidateWorkspacePort` | interface | Materializes an already-verified workspace archive. |
| `AgentCandidateWorkspaceTree` | interface | A workspace stored as one content-addressed object per file plus the manifest that names them. |
| `BuildAgentCandidateBundleInput` | interface | Complete measured surfaces and execution policy compiled into one candidate bundle. |
| `PreparedAgentCandidateKnowledge` | interface | Exact file-backed knowledge admitted by the candidate bundle. |
| `ProtectedAgentCandidateModelGrantContext` | interface | Values available only while one protected model grant is active. |
| `RunProtectedAgentCandidateModelGrantOptions` | interface | Inputs for one protected grant scoped to one bounded caller unit. |
| `RunProtectedAgentCandidateModelGrantResult` | interface | Result and sealed settlement returned after one protected grant closes. |
| `WorkspaceScanLimits` | interface | The per-scan caps a bounded capture applies. |
| `WorkspaceScanOptions` | interface | What a workspace scan reads and how it records a file's permission bits. |
| `WorkspaceTreeExclusion` | interface | One entry the walk recorded but did not describe. Reported rather than dropped: a digest that |
| `AgentCandidateBundleInput` | type | Exact candidate wire shape before the runtime computes its canonical digest. |
| `AgentCandidateCodeSource` | type | Explicit control/no-op code or one finalized CodeSurface whose bytes must still verify. |
| `AgentCandidateExecutionClaimResult` | type | Result of atomically claiming one execution attempt. |
| `AgentCandidateExecutionFailureClass` | type | Only the first class is retryable, and only when the closed model ledger has zero calls. |
| `AgentCandidateExecutionFinishResult` | type | Result of atomically recording an attempt's terminal facts. |
| `AgentCandidateExecutionPhase` | type | Monotonic durable phase: the second value means candidate code could have started. |
| `AgentCandidateExecutionPhaseResult` | type | Result of crossing the irreversible candidate-may-run boundary. |
| `AgentCandidateExecutionStageResult` | type | Result of durably staging the one immutable terminal outbox entry. |
| `AgentCandidateExecutionTerminalRecord` | type | Durable terminal record for one acquired execution attempt. |
| `AgentCandidateExecutionTerminalResult` | type | Evaluator-owned terminal facts staged durably before the terminal CAS. |
| `AgentCandidateExecutorTaskOutcomeCapture` | type | Raw evaluator capture made only after the candidate process is dead. |
| `AgentCandidateModelGrantRunReservationInput` | type | Reservation fields supplied by a caller before Runtime resolves the model. |
| `AgentCandidateModelLimits` | type | Limits mechanically enforced by the evaluator-owned model gateway. |
| `AgentCandidateProfileSource` | type | A complete profile that can be frozen without losing behavior. |
| `AgentCandidateProtectedModelSettlementCall` | type | Protected-port wire call with the gateway's counted input total preserved. |
| `AgentCandidateWorkspaceSnapshotReferences` | type | The canonical workspace evidence without manifest material or embedded file bytes. |
| `PersistedTaskOutcomeEvidence` | type | Immutable evaluator evidence retained with a verified candidate task outcome. |
| `VerifiedAgentCandidateTaskOutcome` | type | Branded task outcome that has survived independent evaluator verification. |
| `WorkspaceTreeAlgorithm` | type | `'tree-v1'` records a file's exact permission bits. `'portable-tree-v1'` records the two modes |
| `WorkspaceTreeEntryPolicy` | type | What a walk does with an entry it refuses to describe: fail, or record and continue. |
| `WorkspaceTreeExclusionReason` | type | Why one entry contributed its name instead of its content. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentCandidateContainerPort`, `AgentCandidateExecutionAttemptRef`, `AgentCandidateExecutionPorts`, `AgentCandidateExecutorWorkspaceFile`, `AgentCandidateExecutorWorkspaceInput`, `AgentCandidateMemoryPort`, `AgentCandidateMemoryResetResult`, `AgentCandidateModelPort`, `AgentCandidatePreparationEvidence`, `AgentCandidateProtectedModelActivation`, `AgentCandidateProtectedModelReservation`, `AgentCandidateProtectedModelSettlement`, `AgentCandidateProtectedRunCapture`, `AgentCandidateVerificationPorts`, `AgentCandidateWorkspaceArtifactsOptions`, `CanonicalCandidateDocument`, `CaptureAgentCandidateWorkspaceOptions`, `CaptureAgentCandidateWorkspaceToArtifactsOptions`, `CapturedAgentCandidateWorkspace`, `CreateAgentCandidateWorkspacePortOptions`, `CreateProtectedAgentCandidateModelPortOptions`, `DescribeWorkspaceTreeOptions`, `DisposePreparedAgentCandidateOptions`, `ExactProcessCandidateExecutorOptions`, `ExecutePreparedAgentCandidateOptions`, `FileAgentCandidateExecutionClaimStoreOptions`, `MaterializeAgentWorkspaceSnapshotOptions`, `PreparedAgentCandidateExecution`, `PreparedAgentCandidateInstruction`, `PreparedAgentCandidateLaunch`, `PreparedAgentCandidateTrace`, `ResolvedAgentCandidateContainer`, `SeedWorkspaceTreeInput`, `VerifiedAgentCandidate`, `WorkspaceTreeDescriptor`, `AgentCandidateModelGrantReserveInput`, `AgentCandidateOutputPurpose`, `AgentCandidateRetryRejection`, `AgentCandidateRunFinalization`, `CaptureAgentWorkspaceSnapshotOptions`.

### Testing fixtures — validated Runtime wire records

Import from `@tangle-network/agent-runtime/testing` — 24 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `driverAgent` | function | Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a |
| `loadAgentImprovementProposalFixture` | function | Load an isolated, production-validated Runtime proposal for consumer tests. |
| `loadAgentProfileImprovementFixture` | function | Load an isolated profile proposal and its private activation state for consumer tests. |
| `runGraphWithTestBrain` | function | Alias for graph tests written before `RunGraphOptions.brain` was production. The production |
| `superviseWithTestBrain` | function | Deterministic scripted-brain path for tests. Not exported from Runtime's main entry. |
| `supervisorAgentWithTestBrain` | function | Scripted-brain construction for deterministic tests. Not exported from Runtime's main entry. |
| `AgentProfileImprovementFixture` | interface | Complete private state for exercising profile activation and restore in consumer tests. |
| `GraphSubtasks` | interface | How a run starts an agent graph as ONE subtask of a manager (`run_graph`). `supervise()` |
| `PeerAuditAccess` | interface | Run-owned read routing between sibling managers. It grants no mutation tools. |
| `PriorCoordination` | interface | Coordination evidence loaded from prior processes of one durable supervised run. |
| `RunGraphTestOptions` | interface | `RunGraphOptions` with the brain REQUIRED — the shape the `/testing` entry's |
| `SpawnPreflightContext` | interface | What a pre-flight sees: the authored child profile and the spawn it is being asked to admit. |
| `SpawnRefusal` | interface | A pre-flight's refusal: the cause it decided on, and the operator-facing evidence for it. |
| `SuperviseTestOptions` | interface | Test-only one-call shape, exported only through the package's explicit `/testing` entry. |
| `SupervisorAgentTestDeps` | interface | Test-only dependency shape. It is exported only through the package's explicit `/testing` |
| `ToolLoopCallContext` | interface | Runtime-owned identity and cancellation for one logical inference call. The wrapper is frozen |
| `AgentProfileImprovementProposalFixture` | type | A proposal produced by Runtime's opaque profile-improvement path. |
| `AuthorizeDownMessage` | type | Product decision over an exact continuation before it is durably recorded or delivered. |
| `ChildQuestionInbox` | type | A manager's intake for an `ask_parent` question raised by a worker it spawned that manages work |
| `CoordinationDeliveryEvidence` | type | Durable delivery evidence retained in commit order. An attempt without a later event carrying |
| `GraphSubtaskPreparation` | type | A graph a manager asked `run_graph` to run, validated and composed by the run that owns the |
| `SpawnPreflight` | type | The gate `CoordinationToolsOptions.preflightSpawn` installs. |
| `ToolLoopChat` | type | One inference turn over the running conversation + the tool specs → the model's text, any |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `DriverAgentOptions`.

### MCP servers — delegate / coordination / detached-session

Import from `@tangle-network/agent-runtime/mcp` — 111 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `collidesWithHarnessNativeTool` | function | The sourced harnesses that publish `name` natively — empty when the name is clear of all of them. |
| `composeLoopTraceEmitters` | function | Fan one `LoopTraceEvent` stream into several emitters — e.g. the |
| `createCoordinationTools` | function | Build the driver's MCP tools over a live scope. |
| `createDelegateHandler` | function | Build the `delegate` tool handler. Closes over the injected supervisor substrate (`router` / |
| `createFleetWorkspaceExecutor` | function | Build an executor that resolves each delegated iteration to an existing |
| `createInProcessExecutor` | function | Build an in-process executor. Returns a {@link DelegationExecutor} whose `client.create()` |
| `createKbGate` | function | Build a fail-closed KB gate. The returned function runs the built-in floor |
| `createMcpServer` | function | Stdio JSON-RPC MCP server exposing the delegation tools (`delegate`, `delegate_feedback`, `delegation_status`, `delegation_history`, optional `delegate_ui_audit`) to sandbox coding-harness agents. |
| `createPropagatingTraceEmitter` | function | Create a LoopTraceEmitter that: |
| `createSiblingSandboxExecutor` | function | Wrap a raw sandbox SDK client so the kernel emits |
| `createStdioToolServer` | function | Build the generic stdio JSON-RPC tool server. |
| `detachedSessionDelegate` | function | Build the sandbox-session coder delegate. It drives `runAgentRounds` against the project's |
| `environmentReader` | function | The environment reader: a manager running inside a provider environment whose `read()` serves |
| `harnessNativeToolNames` | function | The tool names `harness` publishes natively, or `undefined` when no list has been sourced for it. |
| `readTraceContextFromEnv` | function | Read trace context from a process environment (defaults to `process.env`). |
| `resolveSpawnResourcePaths` | function | Replace every `{ kind: 'inline', name, path }` under `profile.resources` with the inline |
| `runDetachedTurn` | function | Dispatch one detached turn and advance it to a terminal state with |
| `LOCAL_HARNESSES` | const | Every local harness, in table order — the one list `AGENT_RUNTIME_LOCAL_HARNESSES` and any |
| `DelegationPersistenceError` | class | A delegation-store read or write failed (filesystem error, store |
| `DelegationTaskQueue` | class | In-process queue for async delegation tasks — submit, cancel, poll status, and read history. |
| `FileDelegationStore` | class | JSON-file persistence for the delegation queue. Each write serializes |
| `AwaitWakeInput` | interface | What a manager waits for, from `awaitWake`. |
| `CheckRead` | interface | One time the check ran inside the run, whatever started it. |
| `CoordinationStats` | interface | Bus throughput plus the pre-flight's own refusal ledger. |
| `CoordinationTools` | interface | The supervisor-side toolbox returned by {@link createCoordinationTools }: the MCP tool |
| `DelegateCodeConfig` | interface | Minimal `CoderTask` overrides exposed over the MCP wire. The full |
| `DelegateError` | interface | What killed a delegation, projected for the calling agent: the rejection's name and message. |
| `DelegateUiAuditRoute` | interface | Optional per-route capture spec the agent surfaces over the wire. |
| `DelegationRecord` | interface | Must be JSON-safe end to end (`args`, `result`, `error`, `feedback`) — |
| `DelegationResumeDriver` | interface | Re-attaches restored in-flight records to their detached runs. The queue |
| `DelegationTraceSpan` | interface | One span of a delegation's compact trace. Flat (parent linkage by id), all |
| `FleetHandle` | interface | Minimal `SandboxFleet` surface the fleet executor calls. Declared |
| `JsonRpcMessage` | interface | One JSON-RPC 2.0 request or notification. |
| `JsonRpcResponse` | interface | One JSON-RPC 2.0 response. |
| `ManagerWake` | interface | One wake of a manager that ended its turn with work open. |
| `McpToolAnnotations` | interface | MCP tool annotations (protocol 2025-03-26 and later). Hints a client reads |
| `McpToolDescriptor` | interface | A callable MCP tool exposed by either stdio server. |
| `McpTransport` | interface | Stdio-shaped transport used by the shared JSON-RPC server implementation. |
| `ResearchOutputShape` | interface | Provider-neutral research output carried over the MCP boundary. The MCP |
| `SpawnResourceBytes` | interface | One successful read: the bytes as a string plus the identity the journal records. |
| `SpawnResourceReader` | interface | Where a by-path resource's bytes come from. `describe` names the source in a refusal so a |
| `UiAuditorDelegationOutput` | interface | Wire-shape of a completed UI-audit delegation. The `findings` array |
| `WorkerSpawnContext` | interface | Immutable task, allocation, identity attribution, and semantic key supplied while a manager's |
| `CoderReviewer` | type | Optional adversarial reviewer over a coder candidate that already passed |
| `CoordinationEvent` | type | Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for |
| `DelegateResult` | type | The synchronous result the `delegate` tool returns to the calling agent: the delivered output (or |
| `DelegationArgs` | type | Arguments accepted by the durable delegation queue. |
| `DelegationResultPayload` | type | Polymorphic `result` field: `CoderOutput` when the underlying profile |
| `DelegationResumeTick` | type | One observation of a detached run, mapped 1:1 from a single-tick driver |
| `LocalHarness` | type | Local coding harness available inside the sandbox — a narrowing of the shared `HarnessType` |
| `SpawnRefusalCause` | type | Why a pre-flight refused a spawn. Each cause is a distinct, separately countable decision. |
| `UiAuditorDelegate` | type | UI-auditor delegate — fully consumer-injected. agent-runtime ships no |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AnalystRegistry`, `CoderOutput`, `CoderReview`, `CoderTask`, `CoordinationToolsOptions`, `CreateKbGateOptions`, `DelegateCodeArgs`, `DelegateHandlerOptions`, `DelegateResearchArgs`, `DelegateResearchConfig`, `DelegateRunCtx`, `DelegateUiAuditArgs`, `DelegateUiAuditConfig`, `DelegationError`, `DelegationExecutor`, `DelegationFeedbackSnapshot`, `DelegationHistoryArgs`, `DelegationHistoryEntry`, `DelegationProgress`, `DelegationResumeContext`, `DelegationRunContext`, `DelegationStatusResult`, `DelegationStore`, `DelegationTaskQueueOptions`, `DetachedSessionDelegateOptions`, `DetachedTurn`, `FactCandidate`, `FactJudge`, `FactJudgeVerdict`, `FeedbackEvent`, `FeedbackRating`, `FeedbackRefersTo`, `FeedbackStore`, `FileDelegationStoreOptions`, `FleetWorkspaceExecutorOptions`, `InProcessExecutorOptions`, `KbGateResult`, `McpServer`, `McpServerOptions`, `Question`, `QuestionOption`, `ResolvedSpawnResourcePath`, `RunDetachedTurnOptions`, `RunLocalHarnessOptions`, `SiblingSandboxExecutorOptions`, `StdioToolServer`, `StdioToolServerOptions`, `SubmitInput`, `SubmitOutput`, `TraceContext`, `CoderDelegate`, `DelegationStatus`, `DetachedWinnerSelection`, `MakeWorkerAgent`, `QuestionLevel`, `QuestionUrgency`, `ResolveSpawnResourcePathsResult`, `SpawnResourceRead`, `UiAuditLensFilter`.

### Supervisor TUI — live terminal view over the on-disk run layout

Import from `@tangle-network/agent-runtime/tui` — 42 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `createTopAgentStream` | function | Project selected conversation rows into ordered reset and row frames. |
| `harnessSessionRows` | function | One ordered projection for every strict native reader, with explicit unrenderable evidence. |
| `isTopJournalEvent` | function | Validate supported journal lifecycle and accounting event shapes. |
| `loadTopSnapshot` | function | Read a point-in-time view without writing to the run. Missing or partial sources report |
| `projectTopSnapshot` | function | Combine supervisor projections and source diagnostics into one snapshot. |
| `projectTopSupervisor` | function | Project committed lifecycle and spend evidence into one supervisor view. |
| `provisionSupervisor` | function | Provision one real provider-backed worker and keep its owning manager alive for controls. |
| `readTopAgentHistory` | function | Task, result and progress use the same projection for file-backed and SQL-backed runs. |
| `readTopAgentInspection` | function | Resolve ordinary Runtime transcript evidence, never a product-specific capture registry. |
| `serveTopWeb` | function | Read-only web transport over the same snapshots as the terminal. No execution or writes. |
| `topAgentMetadata` | function | Metadata keeps full recorded context while the conversation can show compact attribution. |
| `topAgentWorker` | function | One selected-agent mapping for filesystem and API transports; no execution or I/O. |
| `TOP_SNAPSHOT_RECONCILE_MS` | const | Interval for reconciling missed filesystem notifications in the live viewer. |
| `HarnessRowsSession` | interface | The normalized subset consumed here; native decoding stays with harness-sessions. |
| `RecordedActivity` | interface | Actual recorded event time and cadence; absence means no event evidence, never file mtime. |
| `TopSnapshotDiagnostic` | interface | One skipped or partially read snapshot source. `path` is relative to the run directory and |
| `TopSnapshotFrame` | interface | A reconnect always receives current truth; deltas replace changed roots atomically. |
| `TopAgentStreamFrame` | type | Both HTTP transports share conversation selection, stable identity, sequence and batching. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `Distribution`, `RecordedEvents`, `SpendStats`, `SupervisorTotals`, `SupervisorView`, `TopAgentRowsFrame`, `TopInspection`, `TopSnapshot`, `TopSupervisorState`, `TopTranscriptRow`, `TopWebOptions`, `WorkerView`, `BaselineAuthority`, `BudgetStats`, `FileIdentity`, `HarnessRowsGap`, `HarnessSessionRow`, `TopAgentMetadata`, `TopInspectionSource`, `TopJournalEvent`, `TopSessionReader`, `TopSnapshotCompleteness`, `TopSnapshotDiagnosticReason`, `TopSnapshotDiagnosticSource`.

### Bounded task admission and native promise settlement

Import from `@tangle-network/agent-runtime/task-queue` — 4 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `runTaskQueue` | function | Admit bounded work and yield settlements for the caller's policy to interpret. |
| `TaskQueueEntry` | interface | One identified task admitted by a caller-owned ready queue. |
| `TaskQueueSettlement` | type | Native promise settlement, retaining the exact returned or thrown value. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `TaskQueueOptions`.

### Workspace store — versioned per-tenant memory and files, tools, pinned memory, adapter contract

Import from `@tangle-network/agent-runtime/workspace-store` — 36 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `assertWorkspacePath` | function | Refuse anything but an absolute, normalized path such as `/files/report.md`. |
| `checkWorkspacePut` | function | Validate a put before any adapter touches storage; adapters call this first. |
| `createFileTools` | function | `files.list`, `files.read`, `files.write`, `files.delete`, `files.search` over `/files/**` and `/knowledge/**`. |
| `createInMemoryWorkspaceStore` | function | Process-local adapter for tests, previews, and single-instance hosts. |
| `createMemoryTools` | function | `memory.remember`, `memory.recall`, `memory.forget`. |
| `defaultMemoryPolicy` | function | Default authority. Reads: workspace memory, the speaker's own member memory, |
| `readTurnMemories` | function | Workspace memories plus the speaker's own member memories, the set a turn may see. |
| `renderPinnedMemory` | function | Render the memories a turn sees as one stable block for the per-turn preamble. |
| `runWorkspaceStoreContract` | function | Run every contract case against fresh stores; never throws for a failing case. |
| `workspaceStoreContractCases` | function | The contract as named cases; each case builds its own store. |
| `WorkspaceConflictError` | class | A write lost a compare-and-set race or targeted the wrong revision. Re-read and retry. |
| `HarnessProvenance` | interface | Where a captured memory came from. |
| `WorkspaceBytesRef` | interface | Large content kept outside the index, e.g. an R2 object. The adapter owns `key`. |
| `WorkspaceCodecContext` | interface | Where a value lives; bound into the ciphertext. |
| `WorkspaceEntry` | interface | One live document. Exactly one of `content` and `bytes` is present. |
| `WorkspaceStore` | interface | Versioned path store for one or many tenants. Every write is a compare-and-set |
| `WorkspaceTombstone` | interface | Erasure record: the content and bytes are gone; only this audit row remains. |
| `WorkspaceToolDefinition` | interface | Structural tool shape, assignable to agent-app's `McpToolDefinition` |
| `WorkspaceTurn` | interface | The speaker of the running turn, resolved by the host from its trusted session. |
| `MakeWorkspaceStore` | type | Make a fresh, empty store for one case. |
| `WorkspaceEntryKind` | type | What an entry holds; memory kinds are written through `memory.remember`, files through `files.write`. |
| `WorkspaceEntryScope` | type | `member` entries live under `/memories/members/<memberId>/`; everything else is `workspace`. |
| `WorkspacePolicyDecision` | type | `null` allows; a string refuses and is shown to the model as the reason. |
| `WorkspaceRole` | type | `viewer` and `guest` are read-only under the default policy. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `ContentCodecOptions`, `HarnessIngestResult`, `MemoryDivergence`, `MemoryPolicy`, `WorkspaceAccess`, `WorkspaceContentCodec`, `WorkspaceDeleteInput`, `WorkspacePutInput`, `WorkspaceStoreContractCase`, `WorkspaceStoreContractOptions`, `WorkspaceStoreContractResult`, `WorkspaceToolContext`.

## 2. agent-eval — substrate primitives to REUSE

The scoring/measurement/judge substrate. **Do NOT re-implement a judge, an authenticity check, a verifier, a statistics routine, a profile-matrix runner, or usage extraction** — import them from here. The category→subpath mapping is curated; the symbols are generated.

### JUDGE — LLM-as-judge, panels, calibration

Import from `@tangle-network/agent-eval` — 18 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `addCalibrationVerdicts` | function | Join new owner verdicts to a set. A verdict already recorded from the same |
| `calibrateJudge` | function | Measure judge quality against human gold labels: computes Cohen's κ, Pearson correlation, and MAE over matched item ids. |
| `createAntiSlopJudge` | function | Create a reusable Judge function from an anti-slop config. |
| `ensembleJudge` | function | Build a campaign-shaped `JudgeConfig` whose `score()` runs every panel |
| `judgeAgreementView` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `judgeFamily` | function | Classify a model id into its provider family. Strips a `@snapshot` suffix |
| `judgeGateDecision` | function | Whether a judge may gate now, and every reason it may not. |
| `judgeSpans` | function | Query judge-kind spans from the trace store, optionally scoped to a single run. |
| `llmJudge` | function | Build a campaign-shaped `JudgeConfig` whose `score()` makes ONE LLM call |
| `registerCalibrationSet` | function | Validate a calibration set and return a normalized copy ordered by example |
| `runIntentMatchJudge` | function | Run the intent-match judge. Soft-fails to available=false on error. |
| `runKeywordCoverageJudge` | function | Score expected concepts against an already-fetched HTML payload + any |
| `runSemanticConceptJudge` | function | Run the semantic concept judge. Soft-fails to available=false on |
| `CalibrationExample` | interface | One item the owner decided, with where that decision is recorded. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `CalibrationMerge`, `CalibrationResult`, `ContinuousCalibrationResult`, `JudgeCalibrationSet`.

### AUTHENTICITY — is-this-real / anti-Goodhart gate

Import from `@tangle-network/agent-eval/authenticity` — 12 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `gateRealness` | function | Anti-Goodhart gate: a required-artifact-missing or faked submission is |
| `scoreAuthenticity` | function | Deterministic authenticity scan of produced files. Pure — same files in, |
| `scoreRealnessBlended` | function | Score realness using the cheapest sufficient signal: trust the deterministic |
| `ProducedFile` | interface | Authenticity — "is this real, or convincing BS?" |
| `CompleteFn` | type | A minimal completion fn — inject your model caller (router/tcloud). Keeps |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AuthenticityNuance`, `AuthenticityResult`, `AuthenticitySignals`, `BlendedRealness`, `RealnessGate`, `RealnessJudgment`, `RealnessBand`.

### VERIFICATION — multi-layer verifier + semantic grading

Import from `@tangle-network/agent-eval` — 9 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `gradeSemanticStatus` | function | Grade a semantic-concept-style judge result into a single layer status. |
| `verifyAgentProfileCell` | function | Verify an `AgentProfileCell`'s `cellId` matches the sha256 of its hash-material |
| `verifyAttestation` | function | Verify a report against its attestation. Returns a typed outcome rather |
| `verifyCompletion` | function | Verify whether a run completed the task. `checkCorrectness` is injected — |
| `MultiLayerVerifier` | class | Ordered DAG of verification layers with dependency-based skipping, per-layer findings, soft-fail semantics, and a blended composite score across all passed layers. |
| `VerificationReport` | interface | Extends the substrate verdict spine: `valid` = `allPass`; `score` is the |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `Finding`, `VerifyOptions`, `LayerStatus`.

### STATISTICS — significance, intervals, effect size

Import from `@tangle-network/agent-eval` — 57 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `benjaminiHochberg` | function | Benjamini–Hochberg false discovery rate. Returns adjusted q-values and |
| `bonferroni` | function | Bonferroni adjustment: multiply every p-value by the test count, clamp at 1. |
| `cliffsDelta` | function | Cliff's delta — a non-parametric effect size for two independent samples. |
| `cohensD` | function | Cohen's d — standardized effect size for two independent groups. |
| `confidenceInterval` | function | Percentile bootstrap confidence interval on the mean of `scores`. |
| `corpusInterRaterAgreement` | function | Corpus-wide inter-rater agreement across N items × M judges × D dimensions. |
| `corpusInterRaterAgreementFromJudgeScores` | function | Convenience adapter for `DimensionJudgeScore[]` data keyed externally by item. |
| `eProcess` | function | Betting test-martingale for bounded observations — the e-process core of |
| `interpretCliffs` | function | Map a Cliff's delta to a qualitative magnitude using the standard |
| `interRaterReliability` | function | Inter-rater reliability — Krippendorff's α under the squared-difference |
| `mannWhitneyU` | function | Mann-Whitney U — two independent samples, no distributional assumption. |
| `mcnemar` | function | McNemar's test for paired binary outcomes — the correct significance test for |
| `mcnemarPower` | function | Power of a McNemar test at a given number of paired observations, the inverse |
| `mcnemarRequiredN` | function | Number of paired observations needed for a McNemar test to reach a target |
| `mulberry32` | function | Tiny seedable PRNG (mulberry32) — deterministic resampling/shuffling, not |
| `pairedBootstrap` | function | Paired bootstrap on (after − before) deltas. Returns a CI on the chosen |
| `pairedCohensDz` | function | Cohen's dz for paired observations: mean(after - before) divided by the |
| `pairedDeltaTest` | function | Tests whether a paired candidate-minus-baseline delta clears a threshold. |
| `pairedEvalueSequence` | function | Run the paired e-value sequence over an in-order delta stream. |
| `pairedMde` | function | Minimum detectable paired effect (standardised units) for a target paired |
| `pairedPromotionPower` | function | Joint power of the configured calls at `n` under the registered alternative: |
| `pairedRiskDifference` | function | Paired risk difference (the effect-size companion to {@link mcnemar}): the |
| `pairedRiskDifferenceExact` | function | Paired risk difference with the EXACT CONDITIONAL interval — the estimator a |
| `pairedRiskDifferenceScore` | function | Paired risk difference with TANGO'S (1998) SCORE INTERVAL — the estimator a |
| `pairedSignTest` | function | Exact one-sided sign test over paired differences. |
| `pairedTTest` | function | Paired t-test — before/after measurements on the SAME items. |
| `partialCredit` | function | Partial credit: returns 0-1 ratio of current toward target |
| `passAtK` | function | Unbiased pass@k for code generation (Chen et al. 2021, "Evaluating Large |
| `pearsonR` | function | Pearson product-moment correlation coefficient r ∈ [-1, 1] between two |
| `ranks` | function | Average-rank-with-ties transform (1-indexed). Tied values receive the mean |
| `requiredSampleSize` | function | Required N per arm for a two-sample comparison at target effect size, |
| `spearmanR` | function | Spearman's rank correlation ρ — Pearson over the average-rank-with-ties |
| `weightedComposite` | function | Weighted composite over judge dimensions: `Σ(score_d · w_d) / Σ(w_d)` across |
| `weightedMean` | function | Weighted mean — falls back to uniform weights when omitted |
| `wilcoxonSignedRank` | function | Wilcoxon signed-rank — paired, no distributional assumption on the deltas. |
| `wilson` | function | Wilson score interval for a binomial proportion. Correct at small n and near |
| `EProcessState` | interface | Complete snapshot of an e-process. Together with the parameters it is |
| `ExactRiskDifferenceResult` | interface | A paired binary effect size with an EXACT interval and the exact test that |
| `McNemarResult` | interface | Result of a McNemar paired-binary significance test. |
| `PairedMcNemarEvidence` | interface | McNemar's exact paired-binary evidence, on the two-point path only. |
| `ProportionInterval` | interface | A binomial proportion estimate with a confidence interval. |
| `RiskDifferenceResult` | interface | A paired binary effect size (treatment rate − control rate) with a CI. |
| `ScoreRiskDifferenceResult` | interface | A paired binary effect size with an interval that is valid at a NONZERO |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `BootstrapOptions`, `BootstrapResult`, `CorpusAgreementOptions`, `CorpusAgreementPerDimension`, `CorpusAgreementReport`, `CorpusScoreRecord`, `EProcess`, `EProcessOptions`, `EProcessStep`, `PairedBootstrapOptions`, `PairedBootstrapResult`, `WeightedCompositeInput`, `WeightedCompositeResult`, `CliffsMagnitude`.

### CAMPAIGN — profile matrix, gates, improvement loop

Import from `@tangle-network/agent-eval/campaign` — 494 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `acquireSingleRunLock` | function | Acquire the lock or throw naming the holder. A lock whose holder is proved |
| `aide` | function | AIDE's search_policy with three changes |
| `analyzeCrossSurfaceInteractions` | function | Build the complete cross-surface evidence matrix and derive all three frozen |
| `asha` | function | Asynchronous successive halving (Li et al., 2020) over one seeded |
| `assertCampaignDesign` | function | Reject campaign designs whose denominator cannot be identified exactly. |
| `assertCodeSurfaceIdentity` | function | Validate the immutable identity shape; the owning executor verifies the Git objects and patch. |
| `assertSearchHistoryMatchesState` | function | Prove that a receipt describes exactly the supplied replayed state. |
| `beam` | function | Beam search: the beam is the top `width` nodes by posterior mean |
| `buildCellSchedule` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `buildEvidenceVector` | function | The Evidence Bus. For each objective, pair candidate vs baseline by full |
| `campaignBreakdown` | function | Per-candidate evidence a reflective/patch proposer grounds its next proposal |
| `campaignCellSearchResult` | function | What `cell-settled` records for one campaign cell: `passed` with the |
| `campaignCoverage` | function | Exact designed-denominator receipt for one campaign. |
| `campaignMeanComposite` | function | Mean composite across cells with complete task-quality evidence. |
| `campaignScenarioIdentity` | function | Redacted but independently verifiable identity of one complete scenario. |
| `campaignSplitDigest` | function | Canonical identity of the exact scenario payloads and replicate count. |
| `campaignSplitDigestFromIdentities` | function | Canonical split identity reconstructed from redacted scenario identities. |
| `canonicalDigest` | function | SHA-256 over the RFC 8785 canonical JSON of `value`. Throws |
| `cellCachePath` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `codeSurfaceIdentityMaterial` | function | Canonical, location-independent identity of a finalized code candidate. |
| `compareOptimizationMethods` | function | Compare complete optimization methods on disjoint train, selection, and final test data. |
| `componentSurfaceIdentityMaterial` | function | Deterministic identity material for a component surface. |
| `composeGate` | function | Compose gates — all must `ship` for the composite to `ship`. First |
| `costFromLedgerSummary` | function | Keep the cost fields a custom optimization method must report. |
| `createProfileMatrixPlan` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createRetainedDispatch` | function | Persist dispatch intent before an external call and its validated result afterward. |
| `createRunCostLedger` | function | Open the durable spend account stored beside a logical run. |
| `createSearchHistoryReceipt` | function | Read the ledger's bytes, replay them through the search codec, and build |
| `crowdedFrontierParent` | function | The hill climb with a different parent: each expansion draws two distinct |
| `decideSearchClaim` | function | Decide the claim from the test cells of the root and the finalists. Call it |
| `decodeExternalTextCandidate` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `defaultProductionGate` | function | Opinionated production gate composing held-out significance, red-team, reward-hacking, and canary checks into a single `Gate.decide` decision. |
| `developmentClaim` | function | The default claim: development numbers over exactly the supplied tasks. |
| `dimensionRegressions` | function | Report required-dimension evidence after full pairing and optional unit means. |
| `discoverEvalFixtures` | function | Walk `evalsDir` and return the relative name of every fixture directory (one containing an exact-case `PROMPT.md`). |
| `emitLoopProvenance` | function | Build the provenance record + OTel spans and persist them durably under the |
| `estimateNode` | function | `estimateNodeFromCells` over the cells a search state holds: `nodeId` |
| `estimateNodeFromCells` | function | The paired contrast of `nodeId` against `against` on the units both scored. |
| `externalSurface` | function | An optimizer candidate as the mutable surface it represents. |
| `externalTextOptimizationMethod` | function | Adapt a third-party text optimizer without reimplementing its search. |
| `finalizeProfileMatrix` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `fsCampaignStorage` | function | Node-filesystem storage — the default. Lazily requires `node:fs` so the |
| `gepaOptimizationMethod` | function | Environment for a bridge child that spawns `claude` CLI subprocesses. |
| `gitWorktreeAdapter` | function | Git-backed `WorktreeAdapter`: creates isolated worktrees on fresh branches, commits agent changes, and discards losers. |
| `heldOutGate` | function | Composable held-out gate: ships only when the lower bound of the DECIDING |
| `heldoutSignificance` | function | Significance of the held-out composite lift: ship only when the lower bound |
| `importExternalEvaluations` | function | Record every evaluation in the callback's observation log as an `external` |
| `importGepaPopulation` | function | Register GEPA's population as nodes and its parent indices as `correlated` |
| `incumbent` | function | The hill climb. The leader starts at the root; a screened node that dodged no |
| `incumbentWithOperatorBandit` | function | The hill climb (as `incumbent`), with its operator drawn from the |
| `inMemoryCampaignStorage` | function | In-memory storage for filesystem-less runtimes. Artifacts + trace spans |
| `isProposedCandidate` | function | Type guard: a proposal carrying its rationale vs a bare |
| `isTransientTransportFailure` | function | True when the error text describes an infrastructure hiccup that should be |
| `llmJudge` | function | Build a campaign-shaped `JudgeConfig` whose `score()` makes ONE LLM call |
| `loadEvalFixture` | function | Load ONE fixture by name: reads `PROMPT.md` (plus `EVAL.ts`/`EVAL.tsx` and `package.json` under |
| `loadEvalFixtureScenarios` | function | Load fixtures (all discovered, or just `names`) as campaign `Scenario`s tagged `eval-fixture`. |
| `makeProposalFinding` | function | Build a finding whose source is explicitly allowed during candidate generation. |
| `measureCampaignCost` | function | Read the source rates for this execution, never a copied model price table. |
| `neutralizationGate` | function | Composable placebo gate: ships only when the candidate's held-out lift is NOT |
| `neutralizeText` | function | Blank every non-whitespace character to a 1-byte filler while preserving all |
| `openSearchLedger` | function | Open a durable filesystem search ledger. Construction performs no I/O; the |
| `pairHoldout` | function | Pair candidate vs baseline holdout observations by FULL cellId. `select` |
| `paretoSignificanceGate` | function | Wrap the bus + a policy as a `Gate`. Plugs into the existing |
| `parseSearchLedgerLine` | function | Verify one stored ledger line in isolation: the schema tag, the entry and |
| `planCampaignRun` | function | Plan a campaign WITHOUT dispatching: computes the manifest hash and the per-cell |
| `planEvalFixtureRun` | function | Dry-run planner for a fixture campaign: loads the scenarios, delegates to `planCampaignRun`, |
| `planSearchClaim` | function | Fix the claim's design from a search that stopped expanding. |
| `powerPreflight` | function | Estimate detectable lift from baseline independent observations before budgeting a comparison. |
| `readExternalOptimizerObservationArtifact` | function | Read and verify the exact callback observation artifact addressed by method provenance. |
| `readGepaCandidatePopulationArtifact` | function | Read GEPA's exact candidate graph from the artifact addressed by method provenance. |
| `renderScoreboardMarkdown` | function | Render the scoreboard as a launch-readiness Markdown document — the literal |
| `renderSearchSummary` | function | `SearchState` as compact text: a header line with the search's shape and |
| `renderSurfaceDiff` | function | Canonical customer-visible description of the exact before/after surfaces. |
| `replaySearchLedgerText` | function | Verify and project immutable search-ledger JSONL through the same codec as |
| `resolveRunDir` | function | Resolve a campaign `runDir`. An absolute path is honored as-is (the caller |
| `resolveWorktreePath` | function | Resolve a code candidate for evaluation only after verifying its immutable |
| `runCampaign` | function | Core campaign orchestrator: fan scenarios through dispatch, score with judges, aggregate bootstrap CIs, and persist reproducible `CampaignResult` records. |
| `runEval` | function | Simplest evaluation preset: run scenarios through dispatch, score with judges, and return a `CampaignResult` — no optimizer, no gate, no PR. |
| `runImprovementLoop` | function | Gated-promotion shell over `runOptimization`: scores the winner against the baseline on a holdout set, runs the release gate, and optionally opens a PR. |
| `runOptimization` | function | Improve a surface as a search on the kernel; see the module comment. |
| `runProfileMatrix` | function | Profile × scenario matrix runner: fan N agent profiles across M scenarios, project each cell to a validated `RunRecord` with real token usage, and enforce the backend-integrity guard before returning. |
| `runProfileMatrixSegment` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runSearch` | function | Run a search to its close, or continue one from its ledger. |
| `scopedOptimizationMethod` | function | Optimize a projection while evaluating every proposal in the complete candidate. |
| `scoreboardSummary` | function | Roll the per-requirement rows up into the launch headline counts. |
| `scoreDiscrimination` | function | Rank scenarios by how well they DISCRIMINATE candidates. |
| `scoreUserStory` | function | Score one story's produced state against its requirements. Thin wrapper over |
| `searchCellId` | function | Deterministic cell id: one node on one task in one split at one repeat. |
| `searchCellSetDigest` | function | Digest of the cells an estimate reads, with the contrast they serve. Cells |
| `searchClaimDecision` | function | The paired decision a closed search's claim made for one finalist it |
| `searchClaimReserveUsd` | function | The claim reserve a search needs: the root and 3 finalists on every test |
| `searchDivergence` | function | The divergence rule: a node whose train mean rose over its parent's on the |
| `searchEdgeId` | function | Deterministic edge id: one proposal of one child within one search. |
| `searchEstimateMethod` | function | The method a paired sample of `pairs` units supports: the one staging |
| `searchModelIdentity` | function | A provider-reported model: a snapshot when its name pins one, else a moving alias. |
| `searchNodeId` | function | Deterministic node id: identical content in one search is one node. |
| `searchPolicyView` | function | A policy's read of a search: `screened` lists the admitted nodes whose screen |
| `searchPosterior` | function | The posterior every node's parent-selection draw uses. Each node's mean is |
| `searchProposalExecution` | function | What ran a proposal: a model when it made a paid call other than a judge's, |
| `searchProposerView` | function | The train-only view `ProposeContext.train` carries. |
| `searchReceiptAccounting` | function | The accounting of a proposal's cost receipts: token and dollar sums, each |
| `searchTaskSetDigest` | function | Digest a split's task list in taskId order. |
| `searchUnitScores` | function | Per-unit means of scored cells, in unitId order. Each unit sums its cells in |
| `sequentialDecide` | function | SurfaceProposer.decide adapter that stops exploration at an e-value threshold. |
| `sequentialOptimizationMethod` | function | Each stage starts from the previous selected candidate, without an intervening release gate. |
| `sequentialPairedGate` | function | Anytime-valid sequential paired gate. Conforms to the existing `Gate` |
| `skillOptOptimizationMethod` | function | Run Microsoft's SkillOpt trainer as a complete optimization method. |
| `surfaceContentHash` | function | Full SHA-256 content identity for a prompt or finalized code surface. |
| `surfaceDiff` | function | A parent-to-child diff of two mutable surfaces, stored as a blob. |
| `surfaceDispatchRef` | function | Bind a campaign cache entry to the exact surface and caller-owned execution revision. |
| `surfaceHash` | function | Short loop key derived from the same content identity as provenance. |
| `surfaceNode` | function | A mutable surface as a node: its content digest, stored bytes and declared surfaces. |
| `transientDispatchFailure` | function | Ready-made `cellRetry.retryable` predicate: true for a dispatch-stage |
| `uniform` | function | Every node gets every train and selection task at every repeat: the root as |
| `userStoryScoreboard` | function | Flatten story verdicts into the per-requirement scoreboard — the literal |
| `validateSearchLedgerEvent` | function | Validate and return a canonical copy. Arrays whose order carries no meaning |
| `verifyCodeSurface` | function | Verify a finalized code surface against its current checkout. This rejects |
| `verifySearchClaim` | function | Make a closed search's claim again from its ledger alone and compare it with |
| `verifySearchHistoryArtifact` | function | Verify the receipt, then resolve its ledger bytes, check them, and replay |
| `verifySearchHistoryReceipt` | function | Verify a receipt's own consistency and digest. |
| `DEFAULT_EXTERNAL_OPTIMIZER_CALLBACK_LIMITS` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DEFAULT_EXTERNAL_OPTIMIZER_PROCESS_LIMITS` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `paretoPolicy` | const | Require a supported gain and every configured regression floor to clear. |
| `SEARCH_CLAIM_RULE` | const | The claim procedure every `SearchClaim` and claim plan names. |
| `SEARCH_ESTIMATOR` | const | The estimator every `NodeEstimate` names. |
| `SEARCH_LEDGER_SCHEMA` | const | Schema tag every search-ledger entry carries. A ledger written under another |
| `FileSearchLedger` | class | Append-only file-backed search ledger with idempotent writes. |
| `SearchLedgerError` | class | Base error for invalid search-ledger input or operations. |
| `SearchLedgerIntegrityError` | class | Error raised when durable search-ledger data fails an integrity check. |
| `SearchRecorder` | class | Writes one search's events into its ledger as they happen. |
| `SearchState` | class | The pure, incremental projection of one search ledger. `apply` refuses any |
| `SearchStateView` | class | A read of `SearchState` at one ledger position. Header, head, audit and |
| `CampaignArtifactWriter` | interface | Scoped artifact writer — `write(path, content)` lands under |
| `CampaignCellFailureReceipt` | interface | Durable `<attempt>/failure-receipt.json` written before a failed cell can |
| `CampaignCellRetryPolicy` | interface | Bounded in-run retry of failed cells. Every attempt dispatches the same |
| `CampaignCostMeter` | interface | Cell-scoped paid-call entry point. The dispatch places every paid operation |
| `CampaignScenarioIdentity` | interface | Redacted identity of a complete scenario payload retained in campaign results. |
| `CampaignStorage` | interface | `CampaignStorage` — the filesystem seam `runCampaign` writes through |
| `CampaignTraceWriter` | interface | Scoped trace writer handed to each dispatch — every span |
| `CodeSurface` | interface | A tier-4 code surface — a finalized candidate change to the agent's |
| `ComparisonCost` | interface | Cost reported by a method or by final test scoring. |
| `ComponentSurface` | interface | Named text components optimized together as one candidate. |
| `CostBreakdown` | interface | Separate units and evidence for a matrix cell; credits are never USD. |
| `CrossSurfaceCandidate` | interface | Immutable identity for a single candidate or a materialized composition. |
| `CrossSurfaceComponent` | interface | One independently proposed change on one caller-defined surface. |
| `CrossSurfaceComponentEvidence` | interface | Per-component trace evidence captured during one task attempt. |
| `CrossSurfaceInteractionPath` | interface | One deterministic growth path starting from a compatible two-surface seed. |
| `CrossSurfaceSelectionPolicy` | interface | Predeclared candidate eligibility and composition policy. |
| `CrossSurfaceTaskRow` | interface | Canonical per-task input row. Consumers may extend this interface with |
| `DispatchContext` | interface | Context handed to every dispatch invocation. Scoped — every |
| `ExternalOptimizerModelCallRequest` | interface | One exact model request admitted by the loopback proxy. |
| `ExternalTextOptimizationMethodConfig` | interface | Configuration for adapting another text optimizer. |
| `FinalEvidencePolicy` | interface | Durable final-data policy. Keep its ledger shared across related campaigns. |
| `Gate` | interface | Composable promotion gate. |
| `GenerationCandidate` | interface | One scored candidate surface in a generation. `dimensions` + `scenarios` |
| `GepaEngineOptions` | interface | Shared settings for one bounded GEPA engine invocation. |
| `GepaEngineRun` | interface | One independently budgeted GEPA engine invocation. |
| `JudgeConfig` | interface | Pluggable dimensional scorer. `score` is the contract: |
| `JudgeScore` | interface | The canonical judge verdict shape — one declaration, shared by campaign |
| `LabeledScenarioWrite` | interface | Required-provenance write. The store rejects writes that |
| `LoopProvenanceRecord` | interface | The durable provenance record: the baseline and winner measurements, the |
| `NodeEstimate` | interface | A paired contrast of one node against another on shared units. `none` below |
| `NodePosterior` | interface | A node's normal posterior on its improvement over the root. |
| `OpenAICompatibleOptimizerModel` | interface | One metered model path supplied by the package that owns execution. |
| `OptimizationMethod` | interface | A complete optimization method, including candidate generation and selection. |
| `OptimizationMethodComposition` | interface | Exact child results; costs and usage remain attributable to their owning methods. |
| `OptimizationMethodInput` | interface | Shared inputs for one optimization method. Final test data is absent. |
| `ParetoParent` | interface | A non-dominated parent on the GEPA Pareto frontier — a |
| `PlaybackContext` | interface | Dispatch context plus the profile under test (which cheap model, etc.). |
| `PlaybackDriver` | interface | Drives the real product through a story and returns the runtime event stream |
| `PlaybackStep` | interface | One step of a user story — what the user does. The driver interprets |
| `PowerPreflightOptions` | interface | Approximate detectable lift from baseline variance and the intended sample size. |
| `PremeasuredOptimizationBaseline` | interface | Optimization inputs, immutable proposal snapshots, and imported baseline validation. |
| `ProposalTrackContext` | interface | The lineage track that requested a proposal. |
| `ProposeContext` | interface | Search state supplied to one candidate-generation call. |
| `ProposedCandidate` | interface | A proposer output carrying the surface AND the WHY behind |
| `RetainedDispatchOptions` | interface | One logical run owns this directory. Callers bind authority and execution/decoder revisions in scope. |
| `RolloutCall` | interface | One tool/action call observed in a rollout: a name plus its arguments. |
| `Scenario` | interface | Stable identifier + kind tag for any scenario. Consumers |
| `ScenarioSignal` | interface | Per-scenario observation: the composite scores each candidate earned on it. |
| `ScoreboardRow` | interface | One row of the launch scoreboard — story × requirement → PASS/FAIL. |
| `ScoreboardSummary` | interface | Launch-readiness headline counts rolled up from the per-requirement rows. |
| `ScoredRollout` | interface | A scored rollout: its calls plus the scalar outcome used to split pass/fail. |
| `ScoredSurfaceOutcome` | interface | Exact measured state for the surface an optimizer is learning from. |
| `SearchAllocationView` | interface | What an allocator reads when it decides. |
| `SearchArtifactCodec` | interface | How a search stores, compares and restores its artifacts. |
| `SearchArtifactRef` | interface | Content-addressed artifact or receipt. Mutable paths are locators only; the |
| `SearchAudit` | interface | Counts and sums over the whole search. Every field is a number or a short |
| `SearchCellAllocatedEvent` | interface | One node on one task in one split at one repeat is planned. `cellId` is |
| `SearchCellPlan` | interface | One cell an allocator wants for a node. |
| `SearchCellSettledEvent` | interface | One attempt at a cell finished. Its RunRecord, when the producer minted one, |
| `SearchCellWork` | interface | One attempt at one cell, as the kernel hands it to an executor. |
| `SearchClaim` | interface | The claim made once, on the sealed test split. `selected` names the node the |
| `SearchClaimDecision` | interface | A node decision the claim makes, ready for `recorder.decideNode`. |
| `SearchClaimPlan` | interface | The claim's design, fixed before any test cell runs, and stored as the |
| `SearchClaimTest` | interface | A finalist's paired test against the root at its Bonferroni confidence. |
| `SearchClosedEvent` | interface | Last event, once. More work on a closed search is a derived search. |
| `SearchEdgeRecordedEvent` | interface | The proposal that derived a node from its parents. |
| `SearchExecutor` | interface | The executor port: lanes, placement, running a cell, and adopting an |
| `SearchExpansion` | interface | One expansion: the parents a proposer derives a child from, and how. |
| `SearchHistoryAuditSummary` | interface | Bounded summary of a search's audit. Exact ids stay in the ledger. |
| `SearchHistoryReceipt` | interface | A bounded proof envelope over one search ledger. |
| `SearchLane` | interface | An execution lane: a pool of slots whose cells share a cost rule. |
| `SearchLedgerBinding` | interface | A ledger and the identities a loop records into it. |
| `SearchNodeDecidedEvent` | interface | A policy, allocator or claim decision about a node. May repeat; the latest wins. |
| `SearchNodeRegisteredEvent` | interface | A content-addressed artifact enters the search. `nodeId` is |
| `SearchOpenedEvent` | interface | First event, once: what is searched, against what, on which tasks, under which budget. |
| `SearchPolicyNode` | interface | What a policy may read about one node. |
| `SearchPolicyView` | interface | What a policy may read about a search. |
| `SearchProposalBlob` | interface | The stored output of one proposal: enough to register its children again. |
| `SearchProposedChild` | interface | One child a proposal returned. |
| `SearchProposerPort` | interface | The proposer port: derives children from the parents the policy chose. |
| `SearchProposerView` | interface | The proposer's own read of a search: its node's cells on the train split, |
| `SearchReservation` | interface | Dollars held for a cell or operation before it runs. `hard`: the lane |
| `SearchRungDecision` | interface | A rank decision an allocator asks the kernel to record. |
| `SearchRunIdentity` | interface | Identities the ledger needs and a loop cannot infer. |
| `SearchScoredCell` | interface | A cell's scored attempt: the inputs of every per-unit statistic. |
| `SearchSourceRef` | interface | Repository, dataset, or package source pinned to an immutable commit or |
| `SearchSurfaceEvidence` | interface | Per-attempt proof that a declared node surface did or did not fire. A |
| `SearchUnitExtension` | interface | How `asha` chooses the units a rung adds beyond the rung below it, for |
| `SearchUnitScore` | interface | Scores of one node on one unit of one split: the sum and count of its |
| `SearchUnknown` | interface | A fact the producer does not have, with the reason. Unknown is never 0. |
| `SeriesDistribution` | interface | Distribution summary of a number series: count, extremes, quantiles, sum. |
| `SessionScript` | interface | One session within a multi-session journey. Dispatch is |
| `SingleRunLockOptions` | interface | Single-run lock for evaluations that share one mutable environment. |
| `SurfaceProposer` | interface | A surface-improvement strategy. Given the current best |
| `UserStory` | interface | A user story = a runnable product journey plus the requirements that define |
| `UserStoryVerdict` | interface | A scored user story — the completion verdict plus its human title. |
| `AxisVerdict` | type | Per-axis verdict from the shared paired decision rule. |
| `CampaignTokenUsage` | type | Token usage accumulated for a cell. Aliased to the canonical `RunTokenUsage` |
| `CostLedgerHandle` | type | Public callback surface for a shared cost ledger. |
| `CrossSurfaceAttemptCompleteness` | type | Whether one candidate attempt produced a usable executable outcome. |
| `DispatchFn` | type | One function: scenario + ctx → artifact. Dispatcher chooses |
| `ExternalOptimizerChatRequest` | type | Provider-neutral request parsed once from the optimizer's loopback protocol. |
| `ExternalOptimizerEvaluationObservation` | type | Durable callback-side record of every candidate submitted for scoring, |
| `ExternalOptimizerModelCall` | type | Execution-neutral model-call seam for an external optimizer. |
| `ExternalOptimizerModelCallResult` | type | Runtime-owned result for one admitted optimizer-model call. |
| `ExternalOptimizerModelExecutionObservation` | type | One opaque Runtime execution record retained for one admitted model call. |
| `ExternalSearchOptimizer` | type | The external optimizers whose searches this module records. |
| `GateCheckStatus` | type | Outcome of one check that contributed to a release decision. |
| `GateDecision` | type | Five-valued verdict taxonomy (MOSS-paper alignment). |
| `GepaAdaptiveEngineRun` | type | An engine in an adaptive run. All engines share the recipe evaluation limit. |
| `GepaOptimizationRecipe` | type | A direct mapping to a GEPA optimization recipe. |
| `GepaRunnerCommand` | type | The command that runs the Python GEPA bridge. |
| `LabeledScenarioSource` | type | Source tag — required on every store write. Used by the |
| `LabelTrust` | type | How much a label can be trusted to evaluate against — the gold-admission |
| `LlmJudgeDimension` | type | A rubric dimension as a bare key or the full `{ key, description }` shape. A |
| `MutableSurface` | type | The mutable surface a proposer changes. Tiers (see |
| `ObjectiveSource` | type | Where an objective's per-cell scalar comes from. `composite` reads the |
| `OptimizationMethodRunOptions` | type | Shared campaign settings applied to every optimization method. |
| `ProfileDispatchFn` | type | Dispatch for one cell: render `profile` against `scenario`, returning the |
| `PromotionPolicy` | type | A promotion strategy: a pure function from the evidence vector to a verdict. |
| `ProposalFinding` | type | A finding explicitly admitted as candidate-generation input. |
| `ProposalFindingOrigin` | type | Data sources that candidate generation may intentionally learn from. |
| `SearchArtifactKind` | type | What a search's nodes are: a mutable agent surface, or an output artifact. |
| `SearchCellResult` | type | What an attempt produced: everything `cell-settled` records except the |
| `SearchCellStage` | type | Where a cell ran relative to the search's decisions. |
| `SearchClaimEstimator` | type | How the claim's paired decision reads per-unit test means, fixed before any |
| `SearchClaimPower` | type | Whether the test split can resolve the claim's minimum effect, checked on |
| `SearchClaimVerification` | type | Whether a closed search's claim is the one its own ledger supports. |
| `SearchEdgeAttribution` | type | How an edge's parents are known. `explicit`: the proposer that created the |
| `SearchLedgerTrustedHeadMode` | type | How this ledger uses its trusted head — the `(sequence, entryHash)` pin kept |
| `SearchModelIdentity` | type | The model an attempt ran: an immutable snapshot, or a moving alias whose |
| `SearchOpening` | type | The header of a search, with plain task lists; the recorder digests them. |
| `SearchSplit` | type | train is the proposer's feedback, selection is private to the policy and |
| `SearchTaskOutcome` | type | `failed` is the agent's defect and carries a score; `errored` is the |
| `SequentialStreamState` | type | Snapshot of one observe-stream: the e-process state plus the gate's own |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AideOptions`, `AllocateSearchCellInput`, `AnalyzeCrossSurfaceInteractionsInput`, `AshaOptions`, `AutoevalsScoreLike`, `AxisEvidence`, `BuildEvidenceVectorOptions`, `BuildLoopProvenanceArgs`, `BuildTraceAnalystSurfaceDispatchOptions`, `CampaignAggregates`, `CampaignBreakdown`, `CampaignCellResult`, `CampaignCoverage`, `CampaignResult`, `CampaignRunPlan`, `CampaignRunPlanCell`, `CodeSurfaceVerification`, `CompareOptimizationMethodsOptions`, `CreateProfileMatrixPlanOptions`, `CreateSearchHistoryReceiptInput`, `CrossSurfaceAdditionDecision`, `CrossSurfaceBestSingleSelection`, `CrossSurfaceBootstrapPolicy`, `CrossSurfaceCandidateComparison`, `CrossSurfaceCandidateEvidence`, `CrossSurfaceCandidateOutcome`, `CrossSurfaceCandidateSummary`, `CrossSurfaceCompositionStep`, `CrossSurfaceDistribution`, `CrossSurfaceEligibility`, `CrossSurfaceEvidenceBreakdown`, `CrossSurfaceInteractionAwareSelection`, `CrossSurfaceInteractionEffect`, `CrossSurfaceInteractionReport`, `CrossSurfaceInteractionTask`, `CrossSurfaceNaiveStackSelection`, `CrossSurfacePairCompatibility`, `CrossSurfacePairEvidence`, `CrossSurfacePairwiseEntry`, `CrossSurfaceRankedSingle`, `CrossSurfaceRelativeCost`, `CrossSurfaceSelections`, `DefaultProductionGateOptions`, `DimensionRegression`, `DiscriminationScore`, `EmitLoopProvenanceArgs`, `EmitLoopProvenanceResult`, `EstimateNodeCellsInput`, `EvalFixture`, `EvalFixtureFile`, `EvalFixtureLoadOptions`, `EvalFixtureScenario`, `EvidenceVector`, `ExternalOptimizationExample`, `ExternalOptimizerCallbackLimits`, `ExternalOptimizerExecutionSummary`, `ExternalOptimizerModelBudget`, `ExternalOptimizerObservationArtifact`, `ExternalOptimizerObservationSummary`, `ExternalOptimizerProcessLimits`, `ExternalOptimizerRunnerCommand`, `ExternalOptimizerSubmittedCandidate`, `ExternalTextEvaluationResponse`, `ExternalTextOptimizerContext`, `ExternalTextOptimizerResult`, `FinalEvidenceUse`, `FinalizedProfileMatrixResult`, `FinalizeProfileMatrixOptions`, `FsLabeledScenarioStoreOptions`, `GateContext`, `GateContribution`, `GateResult`, `GenerationRecord`, `GepaCandidatePopulationArtifact`, `GepaCandidatePopulationCandidate`, `GepaCandidatePopulationSummary`, `GepaCandidateSelectionScore`, `GepaEvaluationImport`, `GepaOptimizationMethodConfig`, `GepaPopulationImport`, `GitWorktreeAdapterOptions`, `HeldOutGateOptions`, `HeldoutSignificance`, `HeldoutSignificanceOptions`, `JudgeAggregate`, `JudgeDimension`, `LabeledScenarioRecord`, `LabeledScenarioSampleArgs`, `LabeledScenarioStore`, `LlmJudgeOptions`, `LoadEvalFixtureScenariosOptions`, `LoopProvenanceArgsFromResult`, `LoopProvenanceBackend`, `LoopProvenanceCandidate`, `LoopProvenanceEvidence`, `LoopProvenanceOptimizationMethod`, `NeutralizationGateOptions`, `OpenAutoPrOptions`, `OpenAutoPrResult`, `OpenSearchLedgerOptions`, `OptimizationMethodComparison`, `OptimizationMethodPairwise`, `OptimizationMethodProvenance`, `OptimizationMethodResult`, `OptimizationMethodScore`, `OptimizationPackageSource`, `OptimizationTokenUsage`, `OptimizerConfig`, `PairedHoldout`, `ParetoSignificanceGateOptions`, `PendingCostCallView`, `PhoenixEvaluationResultLike`, `PhoenixEvaluatorLike`, `PlanCampaignRunOptions`, `PlanEvalFixtureRunOptions`, `PlanSearchClaimInput`, `PowerPreflight`, `ProfileMatrixCoverage`, `ProfileMatrixPlan`, `ProfileMatrixRow`, `ProfileMatrixSegmentResult`, `ProfileSummary`, `PromotionObjective`, `RecordSearchEdgeInput`, `ReferenceEquivalenceJudgeOptions`, `ReferenceEquivalenceScenario`, `RegisterSearchNodeInput`, `RolloutArgumentDiff`, `RolloutArgumentDiffOptions`, `RunCampaignOptions`, `RunEvalOptions`, `RunImprovementLoopResult`, `RunOptimizationOptions`, `RunOptimizationResult`, `RunProfileMatrixOptions`, `RunProfileMatrixResult`, `RunProfileMatrixSegmentOptions`, `RunSearchOptions`, `ScenarioAggregate`, `ScenarioRollup`, `ScoreboardRenderOptions`, `SearchAllocator`, `SearchAttemptAccounting`, `SearchBudget`, `SearchCandidateSurface`, `SearchCell`, `SearchCellCancelledEvent`, `SearchClaimFinalist`, `SearchCompletion`, `SearchDecisionRecord`, `SearchExecutionIdentity`, `SearchFailureReason`, `SearchHistoryAdmissionOptions`, `SearchHistoryCoverage`, `SearchHistoryCoverageRow`, `SearchLedger`, `SearchLedgerAppendResult`, `SearchLedgerEntry`, `SearchNode`, `SearchNodeRef`, `SearchOperation`, `SearchOperationRecordedEvent`, `SearchOperationStartedEvent`, `SearchPolicy`, `SearchPosterior`, `SearchProposalRequest`, `SearchProposalResult`, `SearchProposer`, `SearchRecorderOptions`, `SearchRunResult`, `SearchSpend`, `SearchSplits`, `SearchSplitTasks`, `SearchSummaryOptions`, `SearchTask`, `SequentialDecideFn`, `SequentialDecideOptions`, `SequentialObservation`, `SequentialPairedGate`, `SequentialPairedGateOptions`, `SettleSearchCellInput`, `SingleRunLock`, `SkillOptOptimizationMethodConfig`, `SkillOptTrainerConfig`, `TraceAnalystArtifact`, `TraceAnalystScenario`, `TraceSpan`, `TransientFailureOptions`, `UngroundedLiteralReport`, `Worktree`, `WorktreeAdapter`, `AutoevalsScorerLike`, `CacheIssueReason`, `CacheRead`, `CellScheduleSlot`, `CrossSurfaceAdditionRejectionReason`, `CrossSurfaceIneligibilityReason`, `CrossSurfacePairIncompatibilityReason`, `DefaultProductionGateCheck`, `DefaultProductionRewardHackingOptions`, `EvalFixtureRunPlan`, `EvalFixtureValidationMode`, `ExternalOptimizerEndpointFormat`, `ExternalOptimizerEvaluationRefusalReason`, `ExternalTextCandidate`, `OptimizerModelBudget`, `RedactionStatus`, `RetainedDispatchOutcome`, `RunImprovementLoopOptions`, `SearchCancelReason`, `SearchCloseReason`, `SearchCostAccounting`, `SearchEdgeOperator`, `SearchEstimateMethod`, `SearchHistoryPolicy`, `SearchLedgerEvent`, `SearchLedgerHash`, `SearchNodeDecision`, `SearchNodeStatus`, `SearchOperationKind`, `SearchProposerKind`, `SearchSurfaceEffect`, `SearchSurfaceKind`, `SearchTokenAccounting`, `SearchTraceRef`, `SequentialGateDecision`, `SkillOptRunnerCommand`.

### TOKEN / USAGE — usage extraction + run-record usage types

Import from `@tangle-network/agent-eval` — 4 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `extractUsage` | function | Pull `{ input, output, cached?, cacheWrite? }` from a parsed response |
| `extractUsageFromSse` | function | Extract token usage from a complete SSE response body using the shared SSE |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `LlmUsage`, `RunTokenUsage`.
