<!--
  GENERATED — do not edit. Run `pnpm run docs:api` to regenerate.
  Source: scripts/gen-primitive-catalog.mjs reads the LIVE exports of this
  package + the @tangle-network/agent-eval substrate via the TypeScript compiler.
  A live export missing here = a RED BUILD (scripts/check-docs-freshness.mjs).
-->

# Primitive catalog — the never-stale anti-reinvention inventory

> **GENERATED** from `@tangle-network/agent-runtime@0.89.0` and `@tangle-network/agent-eval@0.108.0` by `scripts/gen-primitive-catalog.mjs`. Do NOT hand-edit — run `pnpm run docs:api`. This is the mechanical companion to the JUDGMENT in `canonical-api.md` (§2 decision table + §1.5 AgentProfile law): that doc says WHICH primitive to reach for and what NOT to build; this catalog proves WHAT exists. Per-symbol signatures + `file:line` live in the per-module pages under `docs/api/`.

## 1. agent-runtime — own public surface

Every subpath this package declares in `package.json` `exports`. Reach for these before hand-rolling a loop, driver, conversation runner, optimizer wrapper, or observability shim.

### Root — task lifecycle, conversation, RSI verbs, observability

Import from `@tangle-network/agent-runtime` — 240 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `agenticGenerator` | function | Full-agentic `CandidateGenerator` (the `shots=N, sandbox=on` setting): run a real coding harness inside the candidate worktree so the agent makes the change in place. |
| `applyRolloutPolicyToProfile` | function | Persist a policy into the profile's extensions namespace. Shallow copy; never |
| `applyRunRecordDefaults` | function | Stamp cross-cutting defaults onto adapter-projected RunRecords without |
| `auditLoopRunner` | function | `audit` mode — analyst loop over captured trace/run data. |
| `buildForwardHeaders` | function | Build the headers to emit on an outbound participant call, given the |
| `buildLoopOtelSpans` | function | Build a nested, real-duration OTLP span tree for ONE loop run from its full |
| `buildLoopSpanNodes` | function | Sink-neutral core behind {@link buildLoopOtelSpans}: reconstruct the |
| `cleanModelId` | function | Trim a candidate model id; `undefined` for non-strings and blanks. |
| `commandVerifier` | function | A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other |
| `composeRuntimeHooks` | function | Merge several {@link RuntimeHooks} into one. Falsy entries are dropped (so you can |
| `computeBackoff` | function | Compute the delay before the next attempt. Default: 250ms exponential with jitter. |
| `createConversationBackend` | function | Wrap a `Conversation` so it satisfies `AgentExecutionBackend`. The result is |
| `createIterableBackend` | function | Wrap any custom async-iterable stream into a typed `AgentExecutionBackend`. |
| `createOpenAICompatibleBackend` | function | OpenAI-compat streaming backend. Routes `runAgentTaskStream` through any |
| `createOtelExporter` | function | Create an OTEL exporter. Returns undefined when no endpoint is configured. |
| `createRuntimeEventCollector` | function | Build an in-memory collector that sanitizes and accumulates `AgentRuntimeEvent`s for inspection. |
| `createRuntimeStreamEventCollector` | function | Streaming-event counterpart of `createRuntimeEventCollector`. Pass each |
| `createSandboxPromptBackend` | function | Build an `AgentExecutionBackend` backed by a sandbox/sidecar `streamPrompt` call. |
| `createSupervisedKnowledgeUpdater` | function | Create an `improveKnowledgeBase` update callback backed by runtime supervision. |
| `d1ToSqlAdapter` | function | Adapt a Cloudflare D1 binding to the SqlAdapter shape. Lives here so D1 |
| `decideKnowledgeReadiness` | function | Map a `KnowledgeReadinessReport` to a three-state branch (`ready` / `blocked` / `caveat`) the runtime, route handlers, and UI shells all switch on. |
| `defaultBuildPrompt` | function | Turn the analyst's findings (+ optional report) into a concrete coder task — |
| `defineConversation` | function | Declarative constructor for a multi-agent `Conversation`. Validates inputs |
| `defineRuntimeHooks` | function | Identity helper that types a {@link RuntimeHooks} literal so the fields are inferred. |
| `deriveExecutionId` | function | Derive a stable executionId from the run identity. The same |
| `driverLoopGenerator` | function | Driver→worker `CandidateGenerator`: an LLM driver on the canonical tool-loop authors, observes, rates, and steers coding-harness sessions in the worktree until the verifier passes or the session budge |
| `enumerateNeighborPolicies` | function | All bounded single-dial neighbors of `policy`, in a fixed priority order: k |
| `exportEvalRuns` | function | Ship self-improvement eval-run events to Tangle Intelligence. Unlike the |
| `findingLines` | function | Render findings as the ranked-evidence block every build prompt ends with. |
| `getModels` | function | Fetch the model catalog from the router's `/v1/models`. Throws on a non-2xx |
| `handleChatTurn` | function | Run one chat turn. Returns immediately with a `ReadableStream` body; |
| `improve` | function | Run the held-out-gated self-improvement loop on ONE profile surface. |
| `improvementDriver` | function | The one reflective/agentic improvement proposer (`SurfaceProposer`): owns the candidate worktree lifecycle and delegates HOW a change is produced to a pluggable `CandidateGenerator`. |
| `isDelegatedLoopMode` | function | Type guard — returns true when `value` is a valid `DelegatedLoopMode` string. |
| `isDepthExceeded` | function | Refuse further forwarding when the inbound depth has reached the limit. |
| `knowledgeReadinessDeliverable` | function | Build the completion check a supervised KB update uses to stop only when the KB is ready. |
| `loopEventToOtelSpan` | function | Convert a LoopTraceEvent into an OtelSpan for export. |
| `makePerAttemptSignal` | function | Build a per-attempt AbortSignal linked to the parent signal AND fired when |
| `mcpBuildPrompt` | function | Build the starting instruction for a coder agent tasked with implementing a new MCP server. |
| `mcpServeVerifier` | function | Build a `Verifier` that boots a generated MCP server over stdio and checks it exposes tools. |
| `mcpToolsForRuntimeMcp` | function | Returns the queue-bound delegation tools projected into OpenAI Chat |
| `mcpToolsForRuntimeMcpSubset` | function | Subset filter — return only the projected tools whose `function.name` |
| `normalizeRolloutPolicy` | function | Normalize an untyped policy bag (a parsed surface or a profile extension) into |
| `notifyRuntimeDecisionPoint` | function | Fire `hooks.onDecisionPoint`, swallowing sync throws and surfacing async failures to `onError`. |
| `notifyRuntimeHookEvent` | function | Fire `hooks.onEvent`, swallowing sync throws and surfacing async failures to `onError`. |
| `parseLoopRunnerArgv` | function | Parse `--mode X --config Y` from an argv tail (`process.argv.slice(2)`). |
| `parseRolloutPolicy` | function | Parse a serialized policy surface. Defensive by design — the proposer reads |
| `rawTraceDistiller` | function | Build an `analyzeGeneration` producer that feeds the proposer RAW-TRACE |
| `readDepth` | function | Read the depth counter off an inbound request. Missing → 0 (caller is the |
| `readinessServerSentEvent` | function | Serialize a `KnowledgeReadinessReport` as a Server-Sent Event string. |
| `reflectiveGenerator` | function | Cheap no-sandbox `CandidateGenerator` (the `shots=1` setting): draft surface edits via the improvement adapter and apply them as one coherent candidate. |
| `researchLoopRunner` | function | `research` mode — research-in-a-loop with valid-only KB growth. |
| `resolveAgentBackend` | function | Resolve the `AgentExecutionBackend` for the chosen `kind`. Reuse this instead |
| `resolveChatModel` | function | Resolve a chat model by precedence: the first candidate carrying a |
| `resolveRouterBaseUrl` | function | Resolve the router base URL from env, normalised — no trailing `/v1` or `/`. |
| `rolloutPolicyProposer` | function | The deterministic `SurfaceProposer` for the `'rollout-policy'` surface. |
| `runAgentTask` | function | Single-shot task lifecycle for adapter-driven tasks: readiness-gated, emits the runtime lifecycle event vocabulary, session-store pluggable. |
| `runAgentTaskStream` | function | Streaming task lifecycle: delegates execution to an `AgentExecutionBackend` (model API, sandbox, or custom iterable) and yields lifecycle events as they happen. |
| `runConversation` | function | Conversation orchestrator. Drives N participants in turn through their own |
| `runConversationStream` | function | Streaming conversation orchestrator: drives N participants in turn through their own backends, enforcing `maxTurns` / `maxCreditsCents` / `haltOn`, yielding per-event stream markers. |
| `runDelegatedLoop` | function | Dispatch a configured loop by mode. Fails loud (throws `ConfigError`) when no |
| `runLoopRunnerCli` | function | Pure CLI core (no process / argv / IO) so it's unit-testable: validate the |
| `runPersonaConversation` | function | Run one worker profile against one persona as a multi-round conversation. |
| `runPersonaDispatch` | function | Wrap {@link runPersonaConversation} as a `ProfileDispatchFn` for |
| `runSupervisedKnowledgeUpdate` | function | Run a runtime supervisor that updates one candidate knowledge base and stops on readiness. |
| `runtimeStreamServerSentEvent` | function | Serialize a `RuntimeStreamEvent` as a Server-Sent Event string. |
| `runToolLoop` | function | Run the bounded tool loop and return the final text + every executed tool |
| `sanitizeAgentRuntimeEvent` | function | Reduce an `AgentRuntimeEvent` to a PII-safe, serializable plain object for telemetry. |
| `sanitizeKnowledgeReadinessReport` | function | Strip PII and large blobs from a `KnowledgeReadinessReport` for safe telemetry emission. |
| `sanitizeRuntimeStreamEvent` | function | Reduce a `RuntimeStreamEvent` to a PII-safe, serializable plain object for telemetry. |
| `selfImproveLoopRunner` | function | `self-improve` mode — agent-eval's one-call closed improvement loop (held-out gated). |
| `serializeRolloutPolicy` | function | Stable serialization — dial order is fixed so identical policies produce |
| `sleep` | function | Resolve after `ms` milliseconds — used for retry backoff in conversation call policy. |
| `slugifySpeaker` | function | Reduce a speaker name to ASCII alphanumerics + dashes. Preserves enough |
| `startRuntimeRun` | function | Construct a runtime-run handle. The returned handle is mutable across its |
| `streamToolLoop` | function | Streaming bounded tool loop: yields each raw turn event (the caller maps + |
| `structuralRolloutPolicyFromProfile` | function | Read the persisted policy off the profile. `undefined` when the profile does |
| `toolBuildPrompt` | function | Build the starting instruction for a coder agent tasked with implementing a new tool. |
| `turnId` | function | Deterministic turn identifier. Stable across retries of the same logical |
| `validateChatModelId` | function | Validate a caller-supplied chat-model id. Rejects non-strings, malformed |
| `worktreeLoopRunner` | function | `code` mode on the GENERIC recursive path: author one `AgentProfile` per harness, run them as a |
| `buildDriverSystem` | const | The driver's stance for `driverLoopGenerator` — the build-domain instance of |
| `DEFAULT_MAX_DEPTH` | const | Hard cap on chained gateway hops; refused beyond this. Default keeps recursion bounded. |
| `DEFAULT_ROUTER_BASE_URL` | const | Default Tangle Router base URL used when no env override is set. |
| `defaultIsRetryable` | const | Default retryable classification — network/timeout class errors. Errors |
| `DELEGATED_LOOP_MODES` | const | All valid delegated-loop mode names — used for validation and CLI surfaces. |
| `FORWARD_HEADERS` | const | Standard names — lowercased so Headers maps interop on every runtime. |
| `INTELLIGENCE_WIRE_VERSION` | const | Wire version the eval-runs ingest enforces (X-Tangle-Wire-Version + body). |
| `optimizerMethod` | const | The shared method block every build/author prompt embeds. Domain framing |
| `RESEARCH_SUPERVISOR_SYSTEM_PROMPT` | const | Standing prompt for a supervisor that grows a shared knowledge base through spawned researchers. |
| `ROLLOUT_POLICY_BOUNDS` | const | Proposal bounds per dial. These are the SEARCH bounds (what the proposer may |
| `ROLLOUT_POLICY_EXTENSION` | const | The profile extensions namespace the policy persists under. |
| `strategyAuthorMethod` | const | The senior authoring process for `authorStrategy` — the same method, shaped |
| `AgentEvalError` | class | Base class for every contract error this package throws — carries the stable |
| `BackendTransportError` | class | A backend transport call (HTTP, gRPC, sidecar IPC) failed with a non-success |
| `CircuitBreakerState` | class | Live circuit-breaker state — one instance per (participant, conversation run). |
| `CircuitOpenError` | class | Thrown when the circuit breaker is open for a participant and no retry is allowed yet. |
| `ConfigError` | class | Configuration missing or malformed (`HOME` unset, required image not supplied, env var absent). |
| `DeadlineExceededError` | class | Thrown when a backend call exceeds its per-attempt deadline. |
| `FileConversationJournal` | class | JSONL on disk. One line per record; first line is the `begin`, subsequent |
| `InMemoryConversationJournal` | class | In-memory `ConversationJournal` — suitable for testing and single-process runs. |
| `InMemoryRuntimeSessionStore` | class | In-memory `RuntimeSessionStore` for single-process use and tests. |
| `JudgeError` | class | A judge call failed in a way that's not retryable: schema parse failure, bad rubric, conflicting dimensions. |
| `NotFoundError` | class | A named resource (run, span, rubric, scenario, dataset row, route) does not exist. |
| `PlannerError` | class | The dynamic-loop planner returned an unusable topology move — the LLM emitted |
| `RuntimeRunStateError` | class | A runtime-run lifecycle method was called in an order the state machine does |
| `SqlConversationJournal` | class | SQL-backed ConversationJournal. Two tables — runs (one row per runId, holds |
| `ValidationError` | class | Caller passed invalid arguments (out of range, mutually-exclusive options, bad shape). |
| `BackendErrorDetail` | interface | Typed transport / backend failure detail. Carried on `backend_error` and |
| `CandidateGenerator` | interface | The byte-producing seam — the ONE thing that differs between the cheap |
| `ChatStreamEvent` | interface | The NDJSON line protocol every product chat client already speaks. |
| `ChatTurnIdentity` | interface | Identity of a chat turn. `tenantId` is the workspace id for workspace- |
| `ChatTurnProducer` | interface | The live side of a turn — what the product's `produce` hook returns. |
| `CircuitBreakerConfig` | interface | Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`. |
| `ConversationJournalEntry` | interface | Durable conversation transcript — survives a driver process crash mid-run. |
| `D1DatabaseLike` | interface | Structural type matching the surface of `D1Database` we depend on, so the |
| `DriverLoopGeneratorOptions` | interface | `driverLoopGenerator` — the driver→worker `CandidateGenerator`: the build |
| `LoopSpanNode` | interface | Sink-neutral node in a reconstructed loop span tree. The root node's |
| `McpServeSpec` | interface | `mcpServeVerifier` — the intrinsic verifier for a built MCP server: the |
| `ModelInfo` | interface | A model entry as returned by the Tangle Router `/v1/models` endpoint. |
| `OpenAIChatTool` | interface | OpenAI Chat Completions tool descriptor. The shape mirrors the |
| `OtelExportConfig` | interface | OTEL span exporter — streams LoopTraceEvents to an OTLP/HTTP collector. |
| `RawTraceDistillerOptions` | interface | `rawTraceDistiller` — the meta-harness `analyzeGeneration` producer. |
| `ReflectiveGeneratorOptions` | interface | `reflectiveGenerator` — the cheap, no-sandbox `CandidateGenerator`. It drafts |
| `RouterEnv` | interface | Env keys the router base URL is resolved from. |
| `RunRecord` | interface | Mandatory paper-grade fields for a single evaluation run. Optional |
| `RuntimeHooks` | interface | The observation seam attached to a running loop (never to the portable genome). |
| `SqlAdapter` | interface | Minimal SQL driver shape. Implementations forward to whichever client the |
| `ToolLoopAssistantToolCall` | interface | One OpenAI-shaped tool-call entry carried on an assistant message. |
| `ToolLoopCall` | interface | Bounded turn-level tool-dispatch loop. |
| `VerifyResult` | interface | Outcome of verifying a candidate worktree. `feedback` (compiler errors, |
| `AgentBackendKind` | type | The transport a chat backend runs on. |
| `AgentEvalErrorCode` | type | Error taxonomy for `@tangle-network/agent-eval`. |
| `ImproveSurface` | type | The agent-profile lever `improve` optimizes. Mirrors the AgentProfile-law |
| `OpenAIChatResponseFormat` | type | `response_format` parameter for OpenAI-compatible chat endpoints. Use |
| `OpenAIChatToolChoice` | type | `tool_choice` parameter for OpenAI-compat chat. Same shape as the OpenAI |
| `PersonaDriver` | type | A persona that drives the conversation: either a full driver `AgentProfile` |
| `PropagatedHeaders` | type | Header bag carried through `AgentBackendContext.propagatedHeaders` so |
| `RetryableErrorPredicate` | type | Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors. |
| `RetryBackoff` | type | Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`. |
| `RuntimeHookPhase` | type | Runtime hook contracts. Hooks are execution-scoped observers, not part of an |
| `ToolCallOutcome` | type | Outcome of one tool dispatch — structurally compatible with a hub/integration |
| `ToolLoopMessage` | type | A message in the running conversation the loop sends to `streamTurn`. |
| `ToolLoopStopReason` | type | Why the loop stopped. `completed` = model finished naturally; `stuck-loop` = |
| `Verifier` | type | Verifies the edited worktree. Sync or async; throws only on a setup fault |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentAdapter`, `AgentBackendContext`, `AgentBackendInput`, `AgentExecutionBackend`, `AgenticGeneratorOptions`, `AgentKnowledgeProvider`, `AgentTaskContext`, `AgentTaskRunResult`, `AgentTaskSpec`, `BackendCallPolicy`, `ChatTurnHooks`, `ChatTurnResult`, `ControlBudget`, `ControlEvalResult`, `ControlRunResult`, `ControlStep`, `Conversation`, `ConversationDriveState`, `ConversationJournal`, `ConversationParticipant`, `ConversationPolicy`, `ConversationResult`, `ConversationTurn`, `D1StmtLike`, `DataAcquisitionPlan`, `DelegatedLoopResult`, `EvalRunEvent`, `EvalRunGeneration`, `EvalRunsExportConfig`, `EvalRunsExportResult`, `HaltContext`, `HaltSignal`, `ImprovementDriverOptions`, `ImproveOptions`, `ImproveResult`, `KnowledgeReadinessCheckInput`, `KnowledgeReadinessReport`, `KnowledgeRequirement`, `LoopRunnerCliArgs`, `LoopRunnerCliResult`, `OtelAttribute`, `OtelExporter`, `OtelSpan`, `PersonaConversationResult`, `ResearchLoopResult`, `ResearchLoopRunnerOptions`, `ResolveAgentBackendOptions`, `ResolvedChatModel`, `RunChatTurnInput`, `RunConversationOptions`, `RunDelegatedLoopOptions`, `RunPersonaConfig`, `RunPersonaConversationOptions`, `RuntimeDecisionEvidenceRef`, `RuntimeDecisionPoint`, `RuntimeEventCollector`, `RuntimeHookContext`, `RuntimeHookErrorContext`, `RuntimeHookEvent`, `RuntimeRunHandle`, `RuntimeRunPersistenceAdapter`, `RuntimeRunRow`, `RuntimeSessionStore`, `RuntimeStreamEventCollector`, `RuntimeTelemetryOptions`, `RunToolLoopOptions`, `SanitizedKnowledgeReadinessReport`, `StreamToolLoopOptions`, `SupervisedKnowledgeUpdateInput`, `SupervisedKnowledgeUpdateOptions`, `SupervisedKnowledgeUpdateResult`, `ToolLoopResult`, `VetoedFact`, `WorktreeLoopRunnerOptions`, `AgentRuntimeEvent`, `AgentRuntimeEventSink`, `AgentTaskStatus`, `AuthSource`, `ControlDecision`, `ConversationStreamEvent`, `DelegatedLoopMode`, `DelegatedLoopRegistry`, `DelegatedLoopRunner`, `ForwardHeaderName`, `HaltPredicate`, `HaltReason`, `KnowledgeReadinessCheck`, `KnowledgeReadinessCheckResult`, `RuntimeDecisionKind`, `RuntimeHookTarget`, `RuntimeStreamEvent`, `StreamToolLoopYield`, `SupervisedKnowledgeUpdater`, `ToolLoopEvent`, `TurnOrder`.

### Vertical agent — manifest + improvement adapter

Import from `@tangle-network/agent-runtime/agent` — 48 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `assertProfileMaterialization` | function | Throw when a candidate changes axes the selected run path cannot carry. |
| `collectAgentRun` | function | Drain `act`'s `events` into an array AND await its `output`. Useful for |
| `createSandboxAct` | function | Build an `AgentRuntime.act` implementation backed by a single prod-profile |
| `createSurfaceImprovementAdapter` | function | The substrate-default `ImprovementAdapter`: resolve each finding's subject to a real surface path, LLM-draft a unified-diff patch, then auto-apply or open a PR. |
| `createSurfaceKnowledgeAdapter` | function | Wire a surface-based `KnowledgeAdapter` that writes analyst proposals to agent surface files. |
| `defineAgent` | function | Construct a validated agent manifest. Throws `AgentManifestError` |
| `defineProfileMaterializationContract` | function | Define the profile axes a concrete run path actually carries into execution. |
| `measureOutcome` | function | Run `runAnalystLoop` and stamp an `OutcomeMeasurement` onto the |
| `renderProfileMaterializationIssues` | function | Format profile-axis drop issues into a concise operator-facing error. |
| `renderSurfaceIssues` | function | Format a list of surface validation issues into a human-readable error string. |
| `resolveSubjectPath` | function | Resolve a parsed `FindingSubject` to the file path the substrate |
| `unimplementedAgentRun` | function | Stub for agents whose `runtime.act` is not yet wired to the substrate's |
| `validateProfileMaterialization` | function | Return every changed profile axis that the selected run path would drop. |
| `validateSurfaces` | function | Validate an `AgentSurfaces` map on disk — missing paths fail loud at `defineAgent` time instead of silently skipping self-improvement edits. |
| `AGENT_PROFILE_MATERIALIZATION_AXES` | const | Known AgentProfile axes a run path may or may not carry into execution. |
| `promptOnlyProfileMaterialization` | const | Materialization contract for a run path that only injects prompt text. |
| `promptResourceProfileMaterialization` | const | Materialization contract for a run path that injects prompt text plus inline resources. |
| `sandboxActProfileMaterialization` | const | Materialization contract for `createSandboxAct`, which forwards the full AgentProfile. |
| `AgentManifestError` | class | Thrown when `defineAgent` finds a required surface missing on disk. |
| `AgentManifest` | interface | The full agent manifest. Each agent ships ONE of these. |
| `AgentSurfaces` | interface | Surface declarations. Every path is repo-relative (or absolute) at |
| `AssertProfileMaterializationOptions` | interface | Input for throwing on dropped profile axes. |
| `CreateSurfaceKnowledgeAdapterOpts` | interface | Substrate-default `KnowledgeAdapter` — wraps agent-knowledge's |
| `DefineProfileMaterializationContractOptions` | interface | Input for declaring a run path's profile-axis support. |
| `KnowledgeAdapterDeps` | interface | Build the adapter. We accept the agent-knowledge functions as DI so |
| `OutcomeMeasurement` | interface | `OutcomeMeasurement` — the missing metric that turns the analyst |
| `ProfileMaterializationContract` | interface | Declares which AgentProfile axes a concrete run path really carries. |
| `ProfileMaterializationIssue` | interface | One changed AgentProfile axis that would be dropped by a run path. |
| `SurfaceImprovementEdit` | interface | Substrate-default `ImprovementAdapter` — surfaces-driven, LLM-drafted |
| `SurfaceLifecycle` | interface | One profile surface's artifact-lifecycle wiring — the declarative config a |
| `SurfaceValidationIssue` | interface | Validate that every declared surface exists on disk under `repoRoot`. |
| `ValidateProfileMaterializationOptions` | interface | Input for checking a candidate diff against a run path. |
| `AgentProfileMaterializationAxis` | type | AgentProfile axis name, with `custom:<name>` reserved for caller-owned extensions. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentRubric`, `AgentRunContext`, `AgentRunInvocation`, `AgentRuntime`, `AnalystConfig`, `AutoApplyPolicy`, `CreateSandboxActOptions`, `CreateSurfaceImprovementAdapterOpts`, `DraftPatchInput`, `DraftPatchOutput`, `JudgeConfig`, `OutcomeMeasurementOpts`, `ResolvedSurface`, `RubricDimension`, `KnownAgentProfileMaterializationAxis`.

### Intelligence SDK — Observe + provable-OFF billing

Import from `@tangle-network/agent-runtime/intelligence` — 63 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `compileEffort` | function | Compile resolved `EffortSettings` into the orchestration overrides above. Pure: same |
| `composeCertifiedProfile` | function | Compose a certified profile into a uniform `ResolvedSurface`. Additive over |
| `composeCertifiedProfileFromWire` | function | Lower a plane `CertifiedProfile` straight into a `ResolvedSurface` via |
| `composeCertifiedPrompt` | function | Fold the certified prompt surface (and any certified prompt-folding artifacts: |
| `createCertifiedPromptSource` | function | Create the cached certified-prompt source — the ONE module-scope-cache + |
| `createIntelligenceClient` | function | Create an Observe-mode Intelligence client. Resolves effort, endpoint, and |
| `defaultRedactor` | function | The built-in redactor. Walks objects and arrays; replaces values under |
| `isIntelligenceOff` | function | True when these settings admit NO intelligence spawn — the passthrough |
| `manifestFromProfile` | function | Lower the EXISTING plane wire (`CertifiedProfile`) into a `CapabilityManifest`. |
| `pullCertified` | function | Pull the certified composed profile for a target. Fail-closed: a network |
| `resolveEffort` | function | Compile a named tier (plus optional per-field overrides) into the flat |
| `resolveRedactor` | function | Resolve the redactor a client uses. A caller-supplied hook replaces the |
| `withCertifiedDelivery` | function | Wrap an agent so it (a) Observes each run via the shipped Observe client and |
| `withTangleIntelligence` | function | Wrap a generic `agent` with best-effort Observe-mode tracing, returning the |
| `defaultEffortTier` | const | The default tier when a client declares no effort. `'standard'` turns |
| `CapabilityNotAdmittedError` | class | A binding kind whose resolver case is typed but not yet admitted (rag-index, |
| `AppliedIntelligence` | interface | What the delivery wrapper hands the agent each run. |
| `CapabilityManifest` | interface | The strict generalization of `CertifiedProfile`. `promptSurface` is kept |
| `CertifiedArtifact` | interface | A promoted, certified artifact (one entry in the composed profile). |
| `CertifiedCapability` | interface | One certified unit of agent power. |
| `CertifiedProfile` | interface | The composed certified profile — exactly the shape the plane's |
| `CertifiedPromptSource` | interface | A cached, self-refreshing source of a target's certified prompt additions — |
| `CertifiedPromptSourceOptions` | interface | Options for {@link createCertifiedPromptSource} — the pull coordinates plus |
| `CertifiedPromptSurface` | interface | The active promoted prompt surface for a target. |
| `CertProvenance` | interface | The certify lane's held-out lift travelling WITH delivery. The shipped |
| `CredentialRef` | interface | A named secret a binding requires — declared, never carried. |
| `DeliveryConfig` | interface | Delivery config = the Observe config plus the pull target + refresh cadence. |
| `DoctorReport` | interface | The `doctor()` readiness report — Mode-readiness without any network call. |
| `EffortOverridesCompiled` | interface | The run-config overrides an `EffortSettings` compiles to — the bridge between the |
| `EffortSettings` | interface | The flat, resolved settings a tier compiles to. Every field is individually |
| `HostSpec` | interface | The host a `process-on-infra` binding provisions before its inner binding. |
| `IntelligenceClient` | interface | The Observe-mode Intelligence client. |
| `IntelligenceConfig` | interface | Client configuration. `project` + `apiKey` are the Observe minimum; the |
| `ModeReadiness` | interface | One mode's readiness verdict. |
| `ProvisionedHost` | interface | A live, provisioned host the resolver tore up for a `process-on-infra` arm. |
| `RecordTraceMeta` | interface | Metadata for {@link IntelligenceClient.recordTrace}. |
| `RepoConfig` | interface | Repo coordinates a product may declare for the (later) Gated-PR mode. The |
| `ResolveCtx` | interface | Per-call, per-tenant context the resolver reads. Everything that touches the |
| `ResolvedHook` | interface | One resolved hook — event + the command/matcher the seam folds into |
| `ResolvedRetrieval` | interface | One retrieval handle. The agent never learns vector vs graph vs index. |
| `ResolvedSubagent` | interface | One resolved subagent — folded into `AgentProfile.subagents`. |
| `ResolvedSurface` | interface | What `composeCertifiedProfile` produces. Every binding fans into the same |
| `TraceHandle` | interface | The trace handle a `traceRun` body records into. `recordOutput` captures the |
| `TraceMeta` | interface | Metadata describing one traced run. `runId`/`traceId` default to fresh ids. |
| `TraceOutcome` | interface | The resolved outcome of one traced run, surfaced on the export span and |
| `UsageSplit` | interface | The per-class cost split carried by every trace and outcome. `off` ⇒ |
| `Agent` | type | A generic agent: one async input → output. The shape `withTangleIntelligence` |
| `CapabilityAuth` | type | How a binding authenticates at resolve time. Declared as a REQUIREMENT in the |
| `CapabilityInterface` | type | What the agent consumes. CLOSED — a new runtime kind NEVER extends this. Each |
| `CapabilitySurface` | type | Every interface surface tag — the closed set the resolver fans into slots. |
| `ClientOrConfig` | type | Either a built client or the config to build one. |
| `ContentRef` | type | Where a capability's bytes live. A leaked manifest carries no live secret and |
| `CorpusAccess` | type | Corpus access an intelligence tier permits. `'off'` reads and writes |
| `DeliveredAgent` | type | An agent wrapped by {@link withCertifiedDelivery}: receives the input plus |
| `DeliveryBinding` | type | How a capability is backed. OPEN tagged union — THE extension point. All arms |
| `DeliveryBindingKind` | type | Every binding kind — the open set the resolver dispatches over. |
| `EffortOverrides` | type | Per-field overrides applied on top of a tier preset. Any subset of the |
| `EffortTier` | type | The named effort tiers, lowest to highest. `'off'` is the honest floor |
| `JsonSchema` | type | A JSON Schema object describing a tool's parameters. Kept structural — the |
| `PullOutcome` | type | Typed outcome for the pull — inspect `succeeded` before `value`. A 404 |
| `Redactor` | type | A redactor maps an arbitrary trace value to a safe-to-export value. Pure; |
| `UsageClass` | type | Usage class for billing. Base-stream tokens bill `'inference'`; every |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `PullCertifiedOptions`.

### Recursive atom + loop kernel (alias of ./runtime)

Import from `@tangle-network/agent-runtime/loops` — 467 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `acquireSandbox` | function | Cold-start-resilient sandbox acquisition: create by name, observe readiness from the sandbox's own status (not the create call), and re-attach after gateway timeouts. |
| `analyzeTrace` | function | Collect the source's spans and run the agent-eval batch analyzers over them under one `runId`. |
| `anytimeReport` | function | Derive anytime metrics from waterfall spans. `targets` are the satisficing score |
| `asAuthoredProfile` | function | Narrow an untyped `spawn_agent` profile argument to an `AuthoredProfile`, or null if the |
| `assertModelAllowed` | function | Throw a `ConfigError` when `allowed` is set, `model` is defined, and `model` is not a |
| `assertStrategyContract` | function | Static CONTRACT lint over an authored strategy module — the module-boundary |
| `assessAuthoredProfile` | function | OBSERVE one authored `AgentProfile` and score its richness (no judge verdict is read). The task |
| `auditIntent` | function | The route-rigor analyst: compare declared vs revealed vs user intent over a trajectory and return aligned / drifting / diverged with evidence and one recommended intervention. |
| `authoredWorker` | function | Build a worker AGENT from a profile the supervisor authored: the authored `systemPrompt` + |
| `authorStrategy` | function | Author + load a strategy from losses. Throws when the author emits no loadable module; |
| `breadthStrategy` | function | BREADTH: K independent rollouts (each own artifact), verifier picks the best. |
| `buildSteerContext` | function | Build the `SteerContext` a combinator reads to steer (its `loopUntil.until`, `widen` gate, any |
| `canDisplace` | function | The repair keep-best guard: a challenger displaces the incumbent only when it is |
| `collectAgentTurn` | function | Drain a `streamAgentTurn` stream (or any `RuntimeStreamEvent` stream that |
| `compareCheckOutcomes` | function | The selection order: crash < ran; then official pass-fraction; authored guesses only |
| `completionAuthorizes` | function | Decide whether a `CompletionVerdict` may end the node under the policy: authority scales with the verdict's determinism, and probabilistic verdicts must clear `minConfidence`. |
| `composeCheckSources` | function | Concatenate check sources (official first by convention — ordering does not affect |
| `computeFindingId` | function | Compute the stable finding_id from the identity-defining fields. |
| `connectStdioMcp` | function | Spawn a stdio MCP server, complete the handshake, and return the LIVE connection. |
| `contentAddress` | function | Mint the content-addressed `outRef` for a result artifact: `sha256:<hex>` over a |
| `createAgentEnvironmentProviderRegistry` | function | Create a registry that resolves provider names to concrete provider instances. |
| `createBudgetPool` | function | Create a conserved reservation pool from a root `Budget`. `now()` is injected so the |
| `createEventBus` | function | Create the child→parent coordination bus: one typed pipe for settled outputs, questions, and analyst findings, with a priority-ordered pull queue and a pass-through subscribe lane. |
| `createExecutor` | function | The single built-in executor factory. Picks a leaf backend by data (`config.backend`), |
| `createExecutorRegistry` | function | The open resolver/registry. Pre-registers the three built-ins under their |
| `createInbox` | function | Create the worker-side inbox for the down-leg: the driver's `steer_agent` / `answer_question` messages queue here and the worker's loop drains them at step boundaries and before settle. |
| `createInMemoryRunContext` | function | Build a fresh in-memory run context. Every call returns NEW stores (no shared global |
| `createMcpEnvironment` | function | Wrap any MCP server as an `Environment`: `tools/list` becomes `AgenticTool[]` with provider-safe schemas; the domain supplies only the artifact lifecycle hooks. |
| `createPushTraceSource` | function | A push source for OWNED tool loops (router-tools / cli-bridge tool dispatch): the loop calls |
| `createSandboxLineage` | function | Build a lineage bound to one client + its probed capabilities. The |
| `createSandboxToolPartState` | function | Fresh per-turn {@link SandboxToolPartState} for {@link mapSandboxToolEvent} — an |
| `createScope` | function | Create the reactive `Scope` a driver's `Agent.act` runs inside: spawn children on an atomically reserved conserved budget, settle via the `next()` cursor, journal for replay. |
| `createScopeAnalyst` | function | Build a `ScopeAnalyst` that spawns the analyst agent through `Scope.spawn` (so its compute is |
| `createShapeRegistry` | function | Build a fresh open `ShapeRegistry`. A factory is stored type-erased and re-cast on resolve — the |
| `createSupervisor` | function | The `Supervisor` impl (KEYSTONE, build step 5). |
| `createVerifierEnvironment` | function | Any checkable task as an `Environment`, no tool surface required: the artifact is the worker's answer and the domain is one deployable `check` over it. |
| `createWaterfallCollector` | function | Build a `WaterfallCollector` that records agent spans and renders them as an ASCII timeline. |
| `createWorktreeCliExecutor` | function | Build a worktree-CLI leaf `Executor`. Per-spawn (a fresh worktree + abort + teardown each), so a |
| `decodeToolPart` | function | Decode a part with a specific harness's adapter when known, else try every registered adapter |
| `defaultExtractCandidate` | function | The candidate a shot produced, read from its conversation: the LAST `submit_answer` |
| `defaultSelectWinner` | function | The kernel's winner argmax — best-valid-score, ties broken by earliest index, |
| `defaultToolDetectors` | function | The default online panel for a tool-call pipe: a worker repeating the same call, or hammering |
| `defineLeaderboard` | function | Assemble a declarative spec (`cases` + `prompt` + `score`) into a runnable |
| `definePersona` | function | Build a frozen `Persona`. Fails loud on the executors-supplied invariant: a persona with |
| `defineStrategy` | function | Author a Strategy from the composable steps — the open, compact way. |
| `delegate` | function | Delegate an INTENT to a default authoring supervisor and return its `SupervisedResult` unchanged. |
| `depthStrategy` | function | DEPTH: one persistent artifact, carried across analyst-steered shots. |
| `deterministicCompletion` | function | Completion for a DETERMINISTIC check (build/test/lint/citation/proof): done iff the check |
| `discriminatingMeans` | function | Strategy means recomputed over the DISCRIMINATING tasks only — tasks where the field |
| `driverAgent` | function | Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a |
| `dumbDriver` | function | `dumbDriver` — the pass/fail-only steering control. |
| `equalKOnCost` | function | Assert the arms are comparable at EQUAL conserved COST (tokens + usd), NOT raw iteration |
| `extractLlmCallEvent` | function | Extract a `RuntimeStreamEvent`-shaped `llm_call` from a sandbox event when |
| `failuresAnalyst` | function | The default self-improvement LENS — authored content, not a code path. On each settled worker it hands |
| `fanout` | function | `fanout(items, opts)` — spawn one child per item in a single round (bounded by the conserved |
| `filterAuthoredAsserts` | function | The proven authored-assert filter (lifted from the rigs' generateTests): keep only |
| `finalizeBestDelivered` | function | Keep-best finalize under the completion-oracle: return the highest-scoring DELIVERED child's |
| `flatWidenGate` | function | The flat default `ScopeWidenGate` — never widens, keeping the R2 selector≠judge collision |
| `gateOnDeliverable` | function | Wrap an `Executor` so its settlement `valid` reflects the deliverable check, not the |
| `gitWorkspace` | function | A `Workspace` over a git checkout: materialize an isolated worktree at `ref`, commit produced changes (conflict-aware), and read `head` — hooks disabled, identity pinned. |
| `harvestCorpus` | function | Batch the firewalled `observe()` analyst over completed runs and accrete the trace-derived facts into the durable corpus — the production-traces→corpus write side of the flywheel. |
| `inlineSandboxClient` | function | Adapt an `ExecutorFactory` into a `SandboxClient` for `runLoop`. The factory is |
| `inProcessSandboxClient` | function | Adapt a single `onPrompt(prompt, ctx)` callback into a `SandboxClient` for |
| `jjWorkspace` | function | A jj-backed `Workspace` (Jujutsu, colocated with git for the durable remote). |
| `leaderboard` | function | Aggregate a fleet of records into the ranked, multi-axis report. Pure — no IO, deterministic. |
| `localSandboxClient` | function | A `SandboxClient` that runs the worker same-host with the profile's stdio MCP servers live. |
| `localShell` | function | Host-process `Shell`: run a command via `execFile`, resolving `{ stdout, stderr, code }` (never throws on non-zero exit). |
| `loopCampaignDispatch` | function | Adapter for plain `runCampaign` scenarios. This is the runtime-side pair for |
| `loopDispatch` | function | Adapter for `runProfileMatrix` (profile is an axis). Returns a |
| `loopUntil` | function | `loopUntil(seed, spec)` — one `step` child per round; `fold` accumulates each settlement into |
| `makeFinding` | function | Convenience factory: produce a fully-formed AnalystFinding with the |
| `mapSandboxEvent` | function | Project one `SandboxEvent` onto the `RuntimeStreamEvent` chat-UX vocabulary, |
| `mapSandboxToolEvent` | function | Project one `SandboxEvent` onto the `tool_call` / `tool_result` variants of |
| `materializeLocalMcp` | function | Spawn every enabled stdio server in `profile.mcp` as a same-host child and |
| `modelAuthoredChecks` | function | Default authored-check source: one metered LLM call per task, before sampling, |
| `naiveDriver` | function | `naiveDriver` — the no-signal steering control. |
| `observe` | function | The third-person trace analyst: read a worker's trace and produce steer findings for the next attempt plus durable `learned` facts for the cross-run corpus. |
| `officialChecksFromMeta` | function | Official checks the surface stashed on the task (e.g. MBPP's shown assert). Reads |
| `openSandboxRun` | function | Open a sandbox run. Harness-agnostic: the harness lives in |
| `pairwiseSignificance` | function | Compare EVERY profile pair on the scenarios they both ran — paired-bootstrap effect + CI, a real |
| `panel` | function | `panel(spec)` — spawn the M judge children over the SAME artifact, drain their settlements, |
| `patchDelivered` | function | Build the `DeliverableSpec<WorktreePatchArtifact>`: `check(artifact)` runs the shared mechanical |
| `pickChampion` | function | The champion pick over a means table. 'score' takes the best mean score (ties → |
| `pipeline` | function | `pipeline(stages)` — run the stages in order, feeding each stage's `done` deliverable into the |
| `printBenchmarkReport` | function | Pretty-print a report — the "free optimization" verdict, with the cost vector. |
| `probeSandboxCapabilities` | function | Probe (and memoize per client) what the loop may rely on. A client without a |
| `profileRichnessFinding` | function | Turn a {@link ProfileRichness} verdict into a bus-routable `AnalystFinding` (area `profile-quality`). |
| `promotionGate` | function | Statistical promotion decision over a holdout benchmark: a seeded paired bootstrap (`heldoutSignificance`) whose CI lower bound must clear `deltaThreshold`. |
| `providerAsExecutor` | function | Adapt an environment provider into an `ExecutorFactory` for `createExecutor`. |
| `providerAsSandboxClient` | function | Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths. |
| `registerShape` | function | Register a composed shape on the default `builtinShapes` registry — the one-call extension |
| `registryScopeAnalyst` | function | A `ScopeAnalyst` backed by an `AnalystRegistry` — the panel-of-analysts seam. The registry merges |
| `renderAnytimeTable` | function | One row per (strategy, satisficing target): the shareable time-to-satisfactory table. |
| `renderCorpusToInstructions` | function | The learning-flywheel READ side. Queries the corpus through `filter`, renders the matching facts |
| `renderLeaderboardHtml` | function | Render a self-contained HTML leaderboard page (the hosted surface): the SVG charts + the full Markdown |
| `renderLeaderboardMarkdown` | function | Render the report as a publishable Markdown document: provenance → leaderboard → the full profile×axis |
| `renderLeaderboardSvg` | function | Render a self-contained SVG: a ranked score bar chart on top, the profile×axis heatmap below. No deps, |
| `renderPairwiseMarkdown` | function | Render the pairwise-significance table — every profile pair's paired delta, CI, and BH-corrected |
| `renderReport` | function | Operator-facing report, split by who should act. The agent block is the |
| `reportLoopUsage` | function | Forward a `LoopResult`'s aggregated cost + token usage into a campaign cost |
| `resolveAgentEnvironmentProvider` | function | Resolve a provider instance or registry name, failing loudly when a name is unknown. |
| `resolveEntrySymbol` | function | The symbol authored checks are pinned to: `task.meta.entryPoint` when the surface |
| `resolveSandboxClient` | function | Resolve a `SandboxClient` for the chosen backend. The generic, dep-light core |
| `routerBrain` | function | The router as a supervisor BRAIN: the canonical `ToolLoopChat` seam backed by the router's |
| `routerChatWithTools` | function | A router completion WITH tool-calling — the operator driver's LLM seam. Passes OpenAI-shape |
| `routerChatWithUsage` | function | One OpenAI-compatible chat completion through the Tangle router, returning text + REAL token usage (`undefined` when the provider omits it — never a fabricated 0). |
| `routerToolLoop` | function | The tool-using router backend: a real agentic loop OVER the Tangle router (which |
| `runAgentic` | function | Run a Strategy through the keystone Supervisor — `Agent.act` over a conserved-budget Scope. |
| `runBenchmark` | function | Run the requested strategies over the tasks, scored by the Environment's own check. |
| `runInWorkspace` | function | Run a worker `body` inside a FRESH clone of a shared `Workspace`, then commit its work back |
| `runLoop` | function | The round-synchronous loop kernel: each round `driver.plan()` fans N tasks to sandboxes (bounded concurrency), parses + validates each output, and folds results through `driver.decide`. |
| `runPersonified` | function | Compose the persona + chosen shape onto a fresh keystone `Supervisor`. Resolves the shape |
| `runStrategyEvolution` | function | Multi-generation strategy search: author candidates from tournament losses, play them against the incumbent at equal budget, promote via `promotionGate` on an untouched holdout slice. |
| `sandboxCheckRunner` | function | Default CheckRunner backend: pipes the check program into `python3` over the sandbox |
| `sandboxClientAsProvider` | function | Adapt a `SandboxClient` into the shared `AgentEnvironmentProvider` contract. |
| `sandboxSessionTraceSource` | function | The SANDBOX / fleet trace source: read a box session's message parts and decode the harness's tool |
| `sanitizeMcpToolSchema` | function | Coerce an MCP inputSchema to an OpenAI-tool-valid top-level object schema. |
| `selectBestIndex` | function | Argmax by `compareCheckOutcomes`, FIRST index wins ties (deterministic; with zero |
| `selectChampion` | function | Search-side champion selection over a tournament report. |
| `selectValidWinner` | function | The single content-free valid-only winner selector. Among the gated-VALID children only |
| `sentinelCompletion` | function | Completion for a sandbox-agent node: done iff the latest output carries the node's stop |
| `serveCoordinationMcp` | function | Stand up the coordination MCP over a live scope. The HOST address is `127.0.0.1` (the bridge runs |
| `settledToIteration` | function | The step-8 merge-boundary adapter (M4): rehydrate a `Settled.done` into the kernel's |
| `spendFromUsageEvents` | function | Fold a normalized `UsageEvent` array into a `Spend`. Tokens and usd are separate |
| `stopSentinel` | function | A unique, attributable stop sentinel for a node (ralph-loop style). Deterministic from the |
| `streamAgentTurn` | function | Run ONE agent turn on any backend kind and stream its events. Yields the |
| `structuralRollout` | function | Build the structuralRollout `Strategy`: k shots → score each by the frozen visible |
| `sumSandboxUsage` | function | Sum the token usage + USD cost of a sandbox turn's events — the one honest way to meter an |
| `supervise` | function | One-call supervisor: build + run a supervisor from its profile with sensible defaults; the raw `supervisorAgent` + `createSupervisor().run` seams stay available for power use. |
| `superviseSurface` | function | Drive a team of agents (spawned + steered by `profile`) to solve a graded `AgenticSurface` task, and |
| `supervisorAgent` | function | Build a supervisor `Agent` from its profile: the brain resolves from `profile.harness` (backend-as-data), the same resolution rule as every worker. |
| `supervisorInstructions` | function | The supervisor SKILL — the how-to the supervisor reads (its system prompt). THE optimizable |
| `trajectoryReport` | function | Reconstruct the whole spawn tree for `root` with per-node + rolled-up `Spend`. Reads the |
| `verify` | function | `verify(spec)` — an IMPLEMENT child produces a candidate, then a SEPARATE VERIFIER child grades |
| `visibleCheckScore` | function | Display scalar for receipts/reports (the rigs' `visibleScore` shape): crash = -1, |
| `watchTrace` | function | Subscribe to a `TraceSource` and run the streaming detectors over its live spans. Returns an |
| `widen` | function | `widen(spec)` — the streaming spawn-on-completion driver. Spawns the seed lineages, then REACTS |
| `workerFromBackend` | function | Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the |
| `worktreeFanout` | function | Build the worktree fanout combinator. Run it with `runPersonified({ persona, shape, task, budget })` |
| `adaptiveRefine` | const | A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot |
| `assertTraceDerivedFindings` | const | Analyst-on-scope (G1) — the analyze→findings→steer wire over the reactive `Scope`. |
| `builtinShapes` | const | The default registry `runPersonified` resolves a shape name against. Empty by construction — |
| `cliWorktreeExecutor` | const | The leaf `createWorktreeCliExecutor` as a backend-as-data factory: a supervisor-authored |
| `defaultAnalystInstruction` | const | The default observer instruction — exported so an optimizer can seed its population. |
| `defaultAuditorInstruction` | const | Default system instruction for intent-auditor agents: diagnose diverged/drifting trajectories. |
| `defaultDelegateBudget` | const | The conserved pool a `delegate()` call applies when the caller does not pass its own `budget`. |
| `defaultProfileRichnessThresholds` | const | Default thresholds for `ProfileRichnessThresholds` — 600 chars / 6 lines minimum system prompt. |
| `defaultStructuralRolloutPolicy` | const | The measured default recipe: 5 samples, 2 guarded repair rounds, 6 authored checks. |
| `refine` | const | Built-in `Strategy`: attempt → `observe()` reads the trace → steer the next attempt → repeat (deepen one lineage). |
| `sample` | const | Built-in `Strategy`: K independent attempts, keep the best-verifying (best-of-N / resample). |
| `sampleThenRefine` | const | The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open), |
| `strategyAuthorContract` | const | The compressed consumable a skill carries: everything an author needs to emit a loop. |
| `FileCorpus` | class | JSONL on disk — one validated `CorpusRecord` per line, append-only. `query` replays the whole |
| `InMemoryCorpus` | class | In-memory `Corpus`. Keyed by record `id`; `append` validates the record, is idempotent on an |
| `InMemoryResultBlobStore` | class | In-memory `ResultBlobStore`. Content-addressed: `put` verifies the supplied |
| `InMemorySpawnJournal` | class | In-memory `SpawnJournal`. Appends are observed-committed only; the impl enforces |
| `McpSpawnFault` | class | A missing start binary / spawn fault: a SETUP bug, never a failed candidate. |
| `SandboxInstance` | class | A sandbox instance with methods for interaction. |
| `SandboxRunAbortError` | class | Thrown when a turn is aborted/timed-out mid-settle. Carries the events drained |
| `Agent` | interface | One self-similar atom. A leaf is an `Agent` that never calls `scope.spawn`; a driver |
| `AgentEnvironmentProviderRegistry` | interface | In-memory registry for named `AgentEnvironmentProvider` instances. |
| `AgenticSurface` | interface | A stateful, checkable environment an agent operates over with tools. Open behind one interface. |
| `AgenticTask` | interface | The general agentic primitive — sequential (depth) and parallel (breadth) over a shared, |
| `AgentProfile` | interface | Public provider-neutral agent profile contract. |
| `AgentRunSpec` | interface | Sandbox-SDK-shaped agent specification. |
| `AgentSpec` | interface | `AgentProfile` does NOT carry a `harness`/backend field — `harness` lives on the |
| `AgentTurnUsage` | interface | Metered usage of one turn, summed over every cost-bearing event the backend |
| `AnalystFinding` | interface | Unified envelope every analyst emits. Schema-versioned so renderers |
| `AnytimeTaskCurve` | interface | anytimeReport — time-to-satisfactory-output metrics, derived entirely from the |
| `AuditIntentInput` | interface | auditIntent — the route-rigor analyst: is this trajectory even going the RIGHT WAY? |
| `AuthoredProfile` | interface | What the supervisor AUTHORS per sub-task — a worker recipe (a partial `AgentProfile`). |
| `BenchmarkCell` | interface | One strategy's outcome on one task — the per-task cell an optimizer consumes. |
| `BenchmarkReport` | interface | Benchmark output: per-strategy means plus the full per-task × per-strategy losses table an optimizer mines. |
| `Budget` | interface | A budget envelope on a spawn or the root. All ceilings; the pool reserves against them. |
| `BusEvent` | interface | Every bus event is a discriminated union member keyed by `type`. |
| `BusRecord` | interface | A published event stamped for ordering and observability. `seq` is the monotonic publish index; |
| `CheckExecChannel` | interface | Minimal exec channel the default runner needs. `SandboxInstance` (and therefore |
| `CheckOutcome` | interface | How one candidate fared against the frozen visible checks, split by check kind. |
| `CheckpointCapableBox` | interface | Loop-side widening of the box's optional checkpoint method. The |
| `CheckRunner` | interface | Executes the frozen checks against one candidate. Implementations MUST fail loud |
| `CheckSource` | interface | Produces the task's visible checks. MUST derive them from agent-visible information |
| `CheckSourceCtx` | interface | What a CheckSource composes with. `consult` is the strategy family's raw analyst |
| `CollectedAgentTurn` | interface | A drained turn: the terminal summary plus every event the stream yielded. |
| `CompletionAnalyst` | interface | Reads a node's trace → a completion verdict. Same input shape as the `analyze` hook, so |
| `CompletionEvidence` | interface | Trace-derived evidence for a completion claim — an artifact (output) or a verifier metric, |
| `CompletionPolicy` | interface | When a verdict authorizes the driver to END. Deterministic → trust (ground truth); |
| `CompletionVerdict` | interface | The "is it done?" verdict an analyst returns to the parent. |
| `CoordinationMcpHandle` | interface | Serve the coordination verbs (spawn_agent / await_event / observe_agent / steer_agent / stop) |
| `Corpus` | interface | The durable cross-run corpus — the learning-flywheel store. DISTINCT from `SpawnJournal` |
| `CorpusFilter` | interface | A corpus query filter — every field is an AND-narrowing; an omitted field does not constrain. |
| `CorpusRecord` | interface | One accreted fact in the cross-run corpus — the learning-flywheel's durable unit. DISTINCT from |
| `CreateSandboxOptions` | interface | Configuration for creating a new sandbox. |
| `CreateScopeAnalystOptions` | interface | The analyst run an `Agent<unknown, AnalystFinding[]>` performs over the children settled so far. |
| `CriuCapableClient` | interface | Narrowed view of the optional CRIU probe. The loop-side `SandboxClient` |
| `DefaultVerdict` | interface | Minimal verdict shape — `valid` + `score` are required; `scores` + |
| `DefinePersonaInput` | interface | The minimal input to build a `Persona`. Mirrors `Persona` but lets the builder default |
| `DelegateOptions` | interface | Inputs to {@link delegate}. The intent is the first positional arg; everything here is optional |
| `DeliverableSpec` | interface | The deployable completion oracle passed to {@link gateOnDeliverable}: a `check` that |
| `DriverAgentOptions` | interface | `driverAgent` — the driver's BRAIN. |
| `DumbDriverOptions` | interface | Options for {@link dumbDriver}. |
| `EqualKArm` | interface | One arm of an equal-k comparison — a labeled trajectory (a `TrajectoryReport` is one arm's whole |
| `EqualKOnCostOptions` | interface | `equalKOnCost(arms, { tolerance? })` — assert arms are comparable at EQUAL conserved COST |
| `EqualKVerdict` | interface | The equal-k-on-cost verdict: whether every arm spent within `tolerance` of the others on the |
| `EvolutionAuthor` | interface | runStrategyEvolution — the multi-generation strategy search: per generation the system |
| `ExecCtx` | interface | Execution context for `runLoop`: the sandbox client the kernel creates boxes through, plus optional runtime hooks. |
| `Executor` | interface | The leaf runtime — ONE open interface, not a closed union. `execute` returns a |
| `ExecutorContext` | interface | Construction context handed to a `ExecutorFactory` — the seams a built-in needs |
| `ExecutorRegistry` | interface | The OPEN resolver: maps an `AgentSpec` to a `ExecutorFactory`. The default |
| `ExecutorResult` | interface | Terminal artifact of a one-shot `Executor.execute`. |
| `FanoutOptions` | interface | `fanout(items, { synthesize? })` — N children spawned in one round (one per item, bounded by |
| `FanoutSynthesis` | interface | How a fanout's synthesis child is built + read. `synthesisTask` projects the drained child |
| `ForkCapableBox` | interface | Loop-side widening of the box's optional fork method. |
| `HarvestCorpusOptions` | interface | harvestCorpus — production traces → corpus, the G2 bridge (the playbook's step 6). |
| `InboxMessage` | interface | The worker-side receive end of the down-leg: a per-worker inbox an executor exposes as |
| `InMemoryRunContext` | interface | The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`. |
| `InMemoryRunContextOptions` | interface | Options for the in-memory run context. |
| `InProcessPromptCtx` | interface | Context handed to each `onPrompt` / `onTask` call. |
| `Interval` | interface | A 95%-by-default confidence interval. |
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
| `LocalMcpMaterialization` | interface | The live same-host materialization of a profile's `mcp` surface. |
| `LocalSandboxClientOptions` | interface | `localSandboxClient` — the SAME-HOST pseudo-box: a `SandboxClient` whose |
| `LoopCampaignDispatchOptions` | interface | Options for adapting plain agent-eval campaign scenarios into runtime `runLoop` cells. |
| `LoopIterationDispatchPayload` | interface | Where the iteration's worker was placed. `sibling` = a fresh sandbox the |
| `LoopLineageOptions` | interface | Opt-in box-lineage controls for `runLoop`. Default OFF — with both flags |
| `LoopPlanPayload` | interface | Emitted once per `plan()` round, immediately after the driver plans. Carries |
| `LoopTeardownFailedPayload` | interface | Emitted when a box's `delete()` throws or times out during teardown — the |
| `LoopTokenUsage` | interface | LLM token usage. Structurally matches agent-eval's `RunTokenUsage` / |
| `LoopUntilSpec` | interface | `loopUntil({ until, step })` — iterative deepening inside the conserved pool: spawn one `step` |
| `LoopUntilState` | interface | The accumulated state `loopUntil` threads across rounds — the running candidate + the round |
| `McpEndpoint` | interface | Where a handle's MCP server lives; headers carry per-artifact scoping. |
| `MountManifestEntry` | interface | One mounted resource recorded during box preparation — a pure provenance |
| `NaiveDriverOptions` | interface | Options for {@link naiveDriver}. |
| `ObserveInput` | interface | The third-person observer — the connective tissue that closes the loop. |
| `OpenSandboxRunBeforeStartContext` | interface | Context available after the box/session exists and before the first prompt is |
| `OutputAdapter` | interface | Stream of `SandboxEvent`s → typed `Output`. |
| `PairwiseVerdict` | interface | One profile pair compared on the scenarios they BOTH ran — the "who actually beat whom" verdict. |
| `PanelJudge` | interface | One judge in a panel — a labeled persona-derived judge child. Content (the rubric) lives in |
| `PanelSpec` | interface | `panel(judges)` — M judges over ONE artifact, merged WRITE-ONLY (selector≠judge taken to its |
| `PanelVerdict` | interface | One judge child's settled verdict, surfaced to the write-only `merge`. `down` judges carry no |
| `Persona` | interface | The "act like X" record. A thin composition over the keystone's `AgentSpec`: it pairs the |
| `PersonaContext` | interface | The persona context blob — who the loop is acting as. Open by intent: a persona names its |
| `PersonaExecutors` | interface | How a persona supplies executor resolution. Either a pre-built registry (factories already |
| `PipelineStage` | interface | `pipeline(stages)` — sequential composition: each stage's `Outcome.deliverable` feeds the next |
| `ProfileRichness` | interface | Per-field verdict on one authored profile — the raw material the bench renders + scores. |
| `ProfileRichnessThresholds` | interface | Thresholds below which a system prompt is treated as a thin stub. Tunable per call. |
| `ProviderAsSandboxClientOptions` | interface | Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port. |
| `ProviderExecutorOptions` | interface | Options for running a provider as a supervise-mode executor. |
| `ProviderSeam` | interface | Generic environment provider executor config. External packages implement |
| `RegistryAnalyzeProjection` | interface | Project a `ScopeAnalyzeInput` into the `AnalystRegistry.run` arguments. The registry runs over a |
| `RenderCorpusToInstructionsOptions` | interface | Project accreted corpus facts into an `AgentProfile`'s instruction seams — the learning-flywheel |
| `ReservationTicket` | interface | Opaque, single-use reservation handle returned by `reserve` and consumed by |
| `ResolveSandboxClientOptions` | interface | The product-facing backend selector: one call picks the execution transport a |
| `ResultBlobStore` | interface | Content-addressed result blobs (the `outRef` → artifact map) backing the replay |
| `RouterConfig` | interface | The one router chat client: direct OpenAI-compatible completions through the |
| `RouterToolCall` | interface | A tool-call the model emitted (provider-neutral; mirrors the runtime's ToolCallRequest). |
| `RunPersonifiedOptions` | interface | The end-to-end entrypoint. Builds the persona's root `Agent` from the chosen shape, then |
| `RunProvenance` | interface | Domain-free run provenance: a manifest of what was mounted into the run's |
| `SandboxCapabilities` | interface | What the loop kernel is allowed to know about a sandbox backend: a single |
| `SandboxClient` | interface | Minimal sandbox client surface the kernel calls. Satisfied structurally by |
| `SandboxClientProviderOptions` | interface | Options for wrapping the current Tangle sandbox client as an environment provider. |
| `SandboxEvent` | interface | SSE event from sandbox streaming. |
| `SandboxLineage` | interface | Owns box + session handles for one loop run and offers the three |
| `SandboxLineageHandle` | interface | A live box plus the session that threads its iterations together. Handed back |
| `SandboxToolPartState` | interface | Cross-event state for {@link mapSandboxToolEvent}. Sandbox backends emit a |
| `Scope` | interface | The budget-conserving reactive scope an `Agent.act` runs inside. `spawn` reserves |
| `ScopeAnalyst` | interface | The reactive analyst seam — the PORT of the round-synchronous driver's `analyze` hook |
| `ScopeAnalyzeInput` | interface | Input to a `ScopeAnalyst.analyze` — the root task framing + the children settled so far. |
| `ScopeWidenGate` | interface | The runtime widening gate (the reactive analogue of the keystone's `WidenGate`, lifted to read |
| `SelectionReceipt` | interface | A record of one candidate-selection decision: which iteration the selector |
| `SessionCapableBox` | interface | Loop-side widening of the box's optional session accessor. The real |
| `SessionTraceBox` | interface | The minimal box surface this needs: list a session's messages (incl. mid-turn partials). |
| `ShapeBudget` | interface | Budget knobs a shape reads to size its fanout/children WITHOUT owning the conserved pool. |
| `ShapeContext` | interface | The construction context a `LoopShape` factory receives. Carries the persona's resolved |
| `ShapeRegistry` | interface | The open shape registry — the extension point that makes a new loop-shape ONE file + one |
| `ShotPersona` | interface | A role for one shot — multi-agent loops (researcher + engineer, a panel of k |
| `Spend` | interface | Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd |
| `StdioMcpServerSpec` | interface | Same-host stdio MCP: the ONE persistent newline-delimited JSON-RPC 2.0 |
| `SteerContext` | interface | How a combinator's `act` consumes findings to steer — the SINGLE firewalled steer surface a |
| `Strategy` | interface | A Strategy is HOW you spend the compute budget to beat the Environment's check — it |
| `StrategyCtx` | interface | What a strategy body composes with: the artifact lifecycle, the budget, and the two steps. |
| `StructuralRolloutPolicy` | interface | The rollout's compute recipe — promoted from the proven rigs' env vars (K/REPAIRS/ |
| `StructuralRolloutResult` | interface | The body's deliverable — a `StrategyResult` plus selection provenance. The extra |
| `SuperviseSurfaceResult` | interface | The deployable outcome of a supervised surface run. |
| `Supervisor` | interface | Owns the conserved pool, the spawn log, the abort cascade, the OTP intensity breaker, |
| `SupervisorProfile` | interface | The supervisor's profile — the subset of an `AgentProfile` that selects + shapes its brain. |
| `SurfaceWorkerConfig` | interface | How a worker runs the surface task (its router substrate + per-attempt bounds). |
| `SurfaceWorkerOut` | interface | What a surface worker settles with — the surface verdict the driver + deliverable read. `resolved` is |
| `ToolLoopCompaction` | interface | Self-compaction — bound the loop's OWN context window the way a fresh-respawn (dumb-Ralph) loop |
| `TrajectoryAnalysis` | interface | The SETTLE-time analyst: when a worker finishes, collect its tool spans from a `TraceSource` and run |
| `TrajectoryNode` | interface | One node in the reconstructed trajectory tree — a driver OR a leaf, with its OWN spend and the |
| `TrajectoryReport` | interface | The whole reconstructed trajectory — the realized tree + its root-rolled-up total. The |
| `TrajectoryReportOptions` | interface | `trajectoryReport(journal, blobs, root, { withOutputs? })` — reconstruct the whole tree with |
| `TreeView` | interface | The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer. |
| `TurnResult` | interface | One finished turn over the artifact. A failed FS read is surfaced in `readError` |
| `UsageSink` | interface | The slice of an agent-eval campaign `DispatchContext.cost` this needs. |
| `VerifierEnvironmentOptions` | interface | createVerifierEnvironment — ANY checkable task as an `Environment`, no tool surface |
| `VerifySpec` | interface | `verify({ implement, verifier })` — the 2-node sequential gate: an IMPLEMENT child produces a |
| `VisibleCheck` | interface | One task-visible executable check (e.g. a single-line Python assert). |
| `WatchTraceOptions` | interface | The ONLINE analyst: watch a `TraceSource` and fold each tool span through agent-eval's published |
| `WaterfallSpan` | interface | createWaterfallCollector — 100% trajectory observability from the lifecycle stream: |
| `WidenGate` | interface | The progressive-widening gate (MCTS-PW). Decides whether a settled child is |
| `WidenLineage` | interface | A lineage the gate may widen toward — the settled child that looked promising + the findings |
| `WidenSpec` | interface | `widen({ gate })` (G5) — the STREAMING spawn-on-completion driver. Unlike the static-fanout |
| `WorktreeCommandResult` | interface | Outcome of one verification command run in the worktree (test or typecheck). |
| `AgentEnvironmentProviderRef` | type | Provider object or registry name accepted by runtime provider adapters. |
| `AgentProfileRef` | type | Portable profile reference: inline profile or provider catalog id. |
| `AgentTurnBackend` | type | The execution substrate one turn runs on — a closed discriminated union over |
| `ApplyContinuation` | type | Fold a steering string into the caller's Task shape, producing the Task for |
| `AssertTraceDerivedFindings` | type | The firewall assertion contract, re-stated for the reactive seam (PORT of |
| `BudgetReadout` | type | Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`, |
| `CombinatorShape` | type | A combinator is just a `LoopShape`: a factory `(ShapeContext) => Agent` whose `Agent.act` |
| `CoordinationEvent` | type | Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for |
| `DefinePersona` | type | Builds a frozen `Persona`, failing loud on the executors-supplied invariant (neither a |
| `Deliverable` | type | How a typed deliverable `Out` is materialized from a finished turn. |
| `DriveHarness` | type | How to run a sandboxed harness as the DRIVER, with the coordination verbs mounted — the substrate |
| `Environment` | type | A checkable task domain — implement these 5 hooks and the suite does the rest. The |
| `EqualKOnCost` | type | `equalKOnCost(arms, opts)` — the cross-arm equal-compute check on conserved cost. |
| `ExecutorConfig` | type | Config for {@link createExecutor}: the backend is DATA — the cost dial a profile, |
| `ExecutorFactory` | type | Builds a fresh `Executor` for one spawn from the resolved spec. Per-spawn (not |
| `Fanout` | type | `fanout(items, opts)` — build the fanout combinator over a static item list. |
| `FanoutWinnerSelector` | type | A winner-selection strategy: argmax/sort over the gathered child iterations (each output is the |
| `FlatWidenGate` | type | The flat default `ScopeWidenGate` factory contract — never widens, keeping the R2 firewall |
| `InProcessOnPrompt` | type | The user callback: given a prompt and its round, produce the box's event |
| `LoopOptionsForDispatch` | type | runLoop options minus the `ctx` (loopDispatch builds the ctx). |
| `LoopShape` | type | A reusable act-body factory. Given the persona's content + seams (`ShapeContext`), it |
| `LoopUntil` | type | `loopUntil(spec)` — build the iterative-deepening combinator. `seed` is the initial state. |
| `MountRecorder` | type | Records a mounted resource into the run's provenance manifest. Passed to |
| `OpenSandboxRunPromptOptions` | type | Prompt options forwarded to every sandbox prompt turn in this run. The |
| `Outcome` | type | The terminal contract Drew wants: a loop returns a FINISHED deliverable, or the concrete |
| `Panel` | type | `panel(spec)` — build the M-judge write-only-merge combinator. |
| `Pipeline` | type | `pipeline(stages)` — build the sequential combinator from an ordered stage list. The first |
| `RenderCorpusToInstructions` | type | `renderCorpusToInstructions(opts)` — the flywheel read-back projection. Async (queries the |
| `RunPersonified` | type | The composed run signature. |
| `Runtime` | type | The runtime tag of a `Executor` impl. Open by intent: custom runtimes use their own string name. |
| `Settled` | type | A settled child, delivered by `scope.next()`. `seq` is the monotonic cursor order |
| `Shell` | type | Command runner seam. Host code can use `localShell`; sandbox code can wrap `box.exec`. |
| `SteeringDecision` | type | Terminal-or-continue decision shared by all three steering drivers. The |
| `SupervisedResult` | type | Typed terminal result (M2) — a no-winner is NEVER coerced to a best-effort output. |
| `ToolLoopChat` | type | One inference turn over the running conversation + the tool specs → the model's text, any |
| `ToolLoopCompactionOptions` | type | Public supervisor-facing compaction config: same knobs as the primitive, but `distill` is optional |
| `TrajectoryReportFn` | type | `trajectoryReport(...)` — the tree+cost reconstructor. Async (reads journal + optionally blobs). |
| `UsageEvent` | type | Normalized usage event — the single channel every executor reports through, so the |
| `Verify` | type | `verify(spec)` — build the 2-node implement→verifier-gate combinator. |
| `Widen` | type | `widen(spec)` — build the streaming progressive-widening combinator. |
| `WidenDecision` | type | A widening decision: extend one lineage by one child, or stop widening. `flatWidenGate` |
| `WinnerStrategy` | type | Built-in valid-only winner strategies for `selectValidWinner` (selector≠judge): best gated-valid |
| `WorktreePatchArtifact` | type | Terminal artifact of one worktree-CLI run — the canonical worktree-harness result (the captured |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentEnvironment`, `AgentEnvironmentCapabilities`, `AgentEnvironmentEvent`, `AgentEnvironmentProvider`, `AgentEnvironmentQuery`, `AgentEnvironmentSummary`, `AgenticOptions`, `AgenticRunResult`, `AgenticTool`, `AgentSession`, `AgentSessionRef`, `AgentTurnInput`, `AgentTurnResult`, `AnalystRegistry`, `AnytimeReport`, `AnytimeStrategySummary`, `ArtifactHandle`, `AuditIntentOptions`, `AuthoredHarness`, `AuthoredStrategy`, `AuthorStrategyOptions`, `BenchmarkConfig`, `BenchmarkLift`, `BenchmarkStrategySummary`, `BenchmarkTaskRow`, `BudgetPool`, `BusStats`, `ChampionPick`, `CheckpointRef`, `CheckpointRequest`, `CheckRunContext`, `CorpusReadbackOptions`, `CreateAgentEnvironmentInput`, `DefinedLeaderboard`, `Driver`, `EventBus`, `EvolutionArchiveNode`, `EvolutionBandInfo`, `EvolutionCandidate`, `EvolutionGeneration`, `EvolutionReport`, `ExecRequest`, `ExecResult`, `ForkRequest`, `GitWorkspaceOptions`, `HarvestFailure`, `HarvestReport`, `Inbox`, `InProcessSandboxClientOptions`, `IntentAudit`, `Iteration`, `Leaderboard`, `LeaderboardOptions`, `LoopDecisionPayload`, `LoopDispatchOptions`, `LoopEndedPayload`, `LoopIterationEndedPayload`, `LoopIterationStartedPayload`, `LoopPlanDescription`, `LoopResult`, `LoopSandboxPlacement`, `LoopStartedPayload`, `LoopTraceEmitter`, `LoopWinner`, `MaterializeLocalMcpOptions`, `McpEnvironmentOptions`, `McpToolDescriptor`, `Observation`, `ObserveOptions`, `OpenSandboxRunOptions`, `PairwiseOptions`, `PatchDeliverableOptions`, `PlacementInfo`, `PromotionGateOptions`, `PromotionVerdict`, `PublishOptions`, `ResourceRequest`, `RouterChatResult`, `RouterChatToolsResult`, `RouterToolLoopResult`, `RunAgenticOptions`, `SandboxRun`, `ShotSpec`, `StdioMcpConnection`, `StrategyEvolutionConfig`, `StrategyResult`, `StreamAgentTurnOptions`, `StructuralRolloutConfig`, `SuperviseOptions`, `SuperviseSurfaceOptions`, `SupervisorAgentDeps`, `SupervisorOpts`, `SurfaceScore`, `ToolSpec`, `TraceSource`, `ValidationCtx`, `Validator`, `WaterfallCollector`, `WaterfallReport`, `Workspace`, `WorkspaceRequest`, `WorkspaceRun`, `WorktreeCliExecutorOptions`, `WorktreeFanoutOptions`, `AgentEnvironmentStatus`, `AgentSessionStatus`, `ChampionPolicy`, `LoopTraceEvent`, `MakeWorkerAgent`, `RepairStop`, `WorkspaceCommit`.

### Environment provider adapters — generic sandbox/compute bridge

Import from `@tangle-network/agent-runtime/environment-provider` — 32 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `createAgentEnvironmentProviderRegistry` | function | Create a registry that resolves provider names to concrete provider instances. |
| `providerAsExecutor` | function | Adapt an environment provider into an `ExecutorFactory` for `createExecutor`. |
| `providerAsSandboxClient` | function | Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths. |
| `resolveAgentEnvironmentProvider` | function | Resolve a provider instance or registry name, failing loudly when a name is unknown. |
| `sandboxClientAsProvider` | function | Adapt a `SandboxClient` into the shared `AgentEnvironmentProvider` contract. |
| `AgentEnvironmentProviderRegistry` | interface | In-memory registry for named `AgentEnvironmentProvider` instances. |
| `ProviderAsSandboxClientOptions` | interface | Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port. |
| `ProviderExecutorOptions` | interface | Options for running a provider as a supervise-mode executor. |
| `SandboxClientProviderOptions` | interface | Options for wrapping the current Tangle sandbox client as an environment provider. |
| `AgentEnvironmentProviderRef` | type | Provider object or registry name accepted by runtime provider adapters. |
| `AgentProfileRef` | type | Portable profile reference: inline profile or provider catalog id. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentEnvironment`, `AgentEnvironmentCapabilities`, `AgentEnvironmentEvent`, `AgentEnvironmentProvider`, `AgentEnvironmentQuery`, `AgentEnvironmentSummary`, `AgentSession`, `AgentSessionRef`, `AgentTurnInput`, `AgentTurnResult`, `CheckpointRef`, `CheckpointRequest`, `CreateAgentEnvironmentInput`, `ExecRequest`, `ExecResult`, `ForkRequest`, `PlacementInfo`, `ResourceRequest`, `WorkspaceRequest`, `AgentEnvironmentStatus`, `AgentSessionStatus`.

### Analyst loop — trace findings on a running loop

Import from `@tangle-network/agent-runtime/analyst-loop` — 15 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `iterationsToTraceStore` | function | Build an in-memory `TraceAnalysisStore` over a loop round's iterations. Fail-loud on an |
| `runAnalystLoop` | function | `runAnalystLoop` — the one call agent apps reach for to close the |
| `AnalystRegistryLike` | interface | Narrowed shape we accept for `AnalystRegistry` so the orchestrator |
| `AnalystRegistryStreamingLike` | interface | Narrow the `AnalystRegistryLike` further when we need streaming: the |
| `AutoApplyPolicy` | interface | Tunable safety rails for auto-apply. |
| `FindingsStoreLike` | interface | Narrowed shape we accept for `FindingsStore`. |
| `ImprovementAdapter` | interface | Improvement-side bridge — proposes / applies prompt + tool + scaffolding edits. |
| `KnowledgeAdapter` | interface | Knowledge-side bridge — consumers wire `proposeFromFindings` from agent-knowledge. |
| `AnalystLoopEvent` | type | Events emitted by `runAnalystLoop` via `opts.onEvent`. UIs and |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `ImprovementEditBatch`, `ImprovementReport`, `KnowledgeProposalBatch`, `KnowledgeReport`, `RunAnalystLoopOpts`, `RunAnalystLoopResult`.

### Artifact lifecycle — generate → measure → promote → compose

Import from `@tangle-network/agent-runtime/lifecycle` — 63 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `applyArtifact` | function | Return a new profile with `artifact` merged onto `base`. Keyed kinds |
| `applyArtifacts` | function | Apply many artifacts left-to-right; later artifacts win on key conflicts. |
| `buildableGenerator` | function | Build a `CandidateGenerator` for a buildable surface (`tool` / `mcp`). Each |
| `composeProfile` | function | Return a new profile with the top-`k` active artifacts (highest measured lift |
| `createArtifactRegistry` | function | Construct an empty `ArtifactRegistry`. |
| `dedupeArtifacts` | function | Pairwise stack-test the `active` artifacts and retire the redundant half of |
| `driftWatch` | function | Re-measure every `active` artifact and demote those whose held-back lift |
| `gepaRefine` | function | Wrap `gepaProposer` as a `RefinePrompt`. The proposer reflects on the |
| `heldOutPromotionGate` | function | The paper-grade promotion gate: delegate to agent-eval's `HeldOutGate`, which |
| `measureMarginalLift` | function | Run the with/without ablation for `candidate` over `baseline` and return its |
| `productionPromptGenerator` | function | Production `promptGenerator`: refine via `gepaProposer`, seed via a |
| `promptGenerator` | function | Build a `CandidateGenerator` for the prompt surface. Each generation it pools |
| `routerSeedAuthor` | function | A router-backed `AuthorDiverseSeeds`: one structured LLM call that authors |
| `runLifecycle` | function | Run ONE generation of the artifact lifecycle. |
| `skillGenerator` | function | Build a `CandidateGenerator` for the skill surface that distills new skills |
| `sweEvalRunner` | function | Build the `EvalRunner` closed over one fixed SWE exam. `runLifecycle` calls |
| `thresholdPromotionGate` | function | The simplest honest gate: promote iff the candidate's marginal lift on the |
| `worktreeBuildCandidate` | function | Build the production per-candidate seam for `buildableGenerator`. Each call to |
| `lifecycleReasonKey` | const | The metadata key under which the registry records WHY an artifact left the |
| `liftMetadataKey` | const | The metadata key under which the registry stores an artifact's measured held- |
| `ArtifactRegistry` | class | A typed, in-memory registry of `ProfileArtifact`s with stable ids. |
| `ArtifactPayloads` | interface | The payload for each `ArtifactKind`. The shapes are the SAME types the |
| `ArtifactQuery` | interface | Filter for `list`. Omit a field to leave that dimension unconstrained. |
| `BuiltCandidate` | interface | The result of building ONE candidate in its own worktree. A build either |
| `CandidateGenerator` | interface | Produces fresh, UNMEASURED candidate artifacts for ONE profile surface. |
| `CandidateOutcome` | interface | The per-candidate record of what the loop decided and why. |
| `ComposeProfileOptions` | interface | `composeProfile` — fold the top-k active artifacts back into a profile. |
| `DedupeOptions` | interface | `dedupeArtifacts` — retire the redundant half of a non-stacking pair. |
| `DriftCheck` | interface | Per-artifact record of what the re-measure found and decided. |
| `DriftWatchOptions` | interface | `driftWatch` — the scheduled re-measure that DEMOTES decayed artifacts. |
| `EvalResult` | interface | The result of running an eval over ONE profile: a composite score and the cost |
| `GenerateContext` | interface | The read-only context a generator sees when proposing candidates. It is the |
| `MarginalLift` | interface | The marginal lift of one artifact: the with/without ablation. |
| `PairStackCheck` | interface | The stacking verdict for one pair of active artifacts. |
| `ProfileArtifact` | interface | A discrete, individually-promotable piece of an agent profile. |
| `PromotionGate` | interface | Decides whether ONE measured candidate is promoted. The lifecycle calls this |
| `PromotionVerdict` | interface | The verdict a gate returns for one candidate. |
| `PromptDraft` | interface | A proposed prompt instruction line plus the WHY behind it. The `rationale` |
| `RunLifecycleOptions` | interface | `runLifecycle` — the ONE closed-loop orchestrator: generate → measure → |
| `SkillDraft` | interface | A distilled skill draft: a name + the `SKILL.md` body. |
| `SweEvalTask` | interface | The minimal shape of a held-out SWE instance the runner needs. The bench |
| `SweEvalTaskResult` | interface | Per-instance audit row surfaced through `EvalResult.details`. |
| `WorktreeBuildOptions` | interface | `worktreeBuildCandidate` — the PRODUCTION `BuildCandidate`: one fan-out leaf |
| `ArtifactInput` | type | The input to `register` — everything on `ProfileArtifact` except the |
| `ArtifactKind` | type | The profile levers an artifact can target. One-to-one with the §1.5 profile |
| `ArtifactStatus` | type | The artifact lifecycle states. `active` is the load-bearing one — it is the |
| `AuthorDiverseSeeds` | type | SEED — author N genuinely DIVERSE fresh instruction lines from the task spec, |
| `BuildableKind` | type | The buildable surfaces — the kinds whose candidate IS code that must compile |
| `BuildCandidate` | type | BUILD ONE candidate. Given the lifecycle context and the index in the fan-out, |
| `DistillSkills` | type | DISTILL — create new skill drafts from the agent's history. Returns zero or |
| `EvalRunner` | type | Scores a profile. The caller wires this to whatever eval they run — a |
| `RefinePrompt` | type | REFINE — incumbent-grounded rewrites. Given the lifecycle context, return |
| `RefineSkill` | type | REFINE — improve ONE distilled draft (wording, structure, examples). The |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `BuildableGeneratorOptions`, `DedupeResult`, `DriftWatchResult`, `HeldOutPromotionGateOptions`, `MeasureMarginalLiftOptions`, `ProductionPromptGeneratorOptions`, `PromptGeneratorOptions`, `RunLifecycleResult`, `SkillGeneratorOptions`, `SweEvalRunnerOptions`.

### Knowledge orchestration — supervised KB updates

Import from `@tangle-network/agent-runtime/knowledge` — 11 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `createSupervisedKnowledgeUpdater` | function | Create an `improveKnowledgeBase` update callback backed by runtime supervision. |
| `knowledgeReadinessDeliverable` | function | Build the completion check a supervised KB update uses to stop only when the KB is ready. |
| `runSupervisedKnowledgeUpdate` | function | Run a runtime supervisor that updates one candidate knowledge base and stops on readiness. |
| `RESEARCH_SUPERVISOR_SYSTEM_PROMPT` | const | Standing prompt for a supervisor that grows a shared knowledge base through spawned researchers. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `KnowledgeReadinessCheckInput`, `SupervisedKnowledgeUpdateInput`, `SupervisedKnowledgeUpdateOptions`, `SupervisedKnowledgeUpdateResult`, `KnowledgeReadinessCheck`, `KnowledgeReadinessCheckResult`, `SupervisedKnowledgeUpdater`.

### Built-in agent profiles

Import from `@tangle-network/agent-runtime/profiles` — 53 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `appendFindings` | function | Append findings to a workspace, writing one Markdown file per finding |
| `buildAuditorSystemPrompt` | function | Build a system prompt for a single auditor iteration. |
| `coderTaskToPrompt` | function | Render a `CoderTask` into the per-task instruction handed to the coder profile. |
| `createInProcessUiAuditClient` | function | Create a `SandboxClient` that drives a local Playwright browser for in-process UI audits. |
| `createResearcherValidator` | function | Build a validator that closes over a specific `ResearchTask`'s constraints. |
| `createUiAuditorValidator` | function | Build a `Validator` that rejects off-lens findings and findings missing screenshot evidence. |
| `decodeAuditTaskEnvelope` | function | Parse a task envelope back out of a prompt string. Returns undefined if |
| `encodeAuditTaskEnvelope` | function | Wrap a `UiAuditTask` in a machine-readable envelope so iterations are self-describing. |
| `formatAuditorPrompt` | function | Produce the user message for one audit iteration: lens, captures to take, and the task envelope. |
| `initAuditWorkspace` | function | Create the `issues/`, `screenshots/`, and `registry.json` scaffold in a new audit workspace. |
| `multiHarnessResearcherFanout` | function | Build a fanout topology over multiple harnesses. The kernel round-robins |
| `parseAuditorEvents` | function | Parse raw `SandboxEvent` emissions from an audit iteration into structured `UiAuditOutput`. |
| `readAuditRegistry` | function | Read and validate the `registry.json` from an audit workspace. |
| `registerCaptures` | function | Record screenshots taken for a route in the registry, without filing a |
| `researcherProfile` | function | Build a source-grounded researcher profile with output parsing and validation. |
| `summarizeRegistry` | function | Compute finding counts by severity, lens, and route from an `AuditRegistry`. |
| `uiAuditorProfile` | function | Preset `runLoop` bundle for vision-driven UI audits: returns the `AgentRunSpec`, output adapter, validator, and prompt formatter the loop kernel needs. |
| `writeAuditIndex` | function | Regenerate `<workspace>/index.md` from registry.json. |
| `LENS_BRIEFS` | const | Per-lens auditor briefs: concrete signals to look for and cross-lens distinctions to respect. |
| `SHARED_AUDITOR_RULES` | const | Cross-lens rules injected into every UI audit iteration: finding quality standards and scope limits. |
| `UI_FINDING_SEVERITIES` | const | Frozen severity tuple, ordered worst → least bad for sort/report. |
| `UI_LENSES` | const | Frozen tuple of lenses for validation + iteration. |
| `KnowledgeItem` | interface | Knowledge item emitted by the researcher. |
| `ResearcherProfileOptions` | interface | Options for the source-grounded researcher profile preset. |
| `ResearchOutput` | interface | Researcher output. Required fields are typed; optional fields preserve |
| `ResearchTask` | interface | Task contract for a source-grounded research agent. |
| `UiAuditOutput` | interface | Output of one iteration. `findings` is the headline payload; `captures` |
| `UiAuditTask` | interface | One iteration's task: audit a single (lens × route) pair, capturing the |
| `UiFinding` | interface | A single UI audit finding — the unit of work a contributor can act on. |
| `UiFindingScreenshot` | interface | Pointer to a screenshot referenced by a finding (workspace-relative path). |
| `KnowledgeUpdate` | type | A proposed write to the knowledge base. The profile does NOT apply |
| `ResearchSource` | type | Source families a researcher profile may prefer for a task. |
| `UiFindingSeverity` | type | Severity scale. |
| `UiLens` | type | Canonical audit lenses. Each lens scopes a finding to a single class of |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AppendFindingsResult`, `AuditIndex`, `AuditRegistry`, `AuditRegistryCapture`, `BrowserContextHandle`, `BrowserHandle`, `CoderTask`, `InProcessUiAuditClientOptions`, `MultiHarnessResearcherFanoutOptions`, `PageHandle`, `RegisterCapturesOptions`, `UiAuditCapture`, `UiAuditCaptureRequest`, `UiAuditorProfileOptions`, `UiAuditViewport`, `UiJudgeInput`, `UiJudgeOutput`, `UiJudgeTokenUsage`, `UiJudge`.

### Platform glue

Import from `@tangle-network/agent-runtime/platform` — 20 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `PlatformAuthClient` | class | HTTP client for the Tangle Platform SSO: builds authorize URLs and exchanges auth codes for API keys. |
| `PlatformAuthError` | class | Thrown when a `PlatformAuthClient` request returns a non-success status. |
| `PlatformHubClient` | class | HTTP client for the Tangle Platform Hub API: provider catalog, connection flow, and status. |
| `PlatformHubError` | class | Thrown when a `PlatformHubClient` request returns a non-success status. |
| `HealthCheck` | interface | Last-known health for a connection, derived from the connection row. |
| `PlatformAuthClientOptions` | interface | Server-side client for the Tangle platform's cross-site SSO bridge. |
| `PlatformCatalogProvider` | interface | A connectable provider in the catalog (`/v1/hub/providers`). |
| `PlatformConnection` | interface | A live integration connection, as returned by `/v1/hub/connections`. |
| `PlatformHubClientOptions` | interface | Server-side client for the Tangle platform's integration hub |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AuthorizeUrlOptions`, `CatalogResult`, `ConnectionHealth`, `ConnectionHealthResult`, `ExchangeCodeResult`, `ExecInput`, `MintTokenInput`, `MintTokenResult`, `PlatformHubStatus`, `StartAuthInput`, `StartAuthResult`.

### MCP servers — delegate / coordination / detached-session

Import from `@tangle-network/agent-runtime/mcp` — 170 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `buildDelegationTraceSpans` | function | Derive the compact span tree for ONE loop run from its buffered |
| `capDelegationTrace` | function | Enforce the trace caps over an ordered (oldest-first) span list. Drops the |
| `captureWorktreeDiff` | function | Stage all changes in a worktree and return the diff patch + shortstat against the base ref. |
| `coderTaskFromArgs` | function | Canonical `DelegateCodeArgs` → `CoderTask` mapping — the single source for |
| `composeLoopTraceEmitters` | function | Fan one `LoopTraceEvent` stream into several emitters — e.g. the |
| `createCoordinationTools` | function | Build the driver's MCP tools over a live scope. |
| `createDelegateFeedbackHandler` | function | Build the MCP tool handler that persists feedback events and attaches them to delegation records. |
| `createDelegateHandler` | function | Build the `delegate` tool handler. Closes over the injected supervisor substrate (`router` / |
| `createDelegateUiAuditHandler` | function | Build the MCP tool handler that validates input, deduplicates via idempotency key, and enqueues a UI audit. |
| `createDelegationHistoryHandler` | function | Build the MCP tool handler that reads filtered past delegations from a `DelegationTaskQueue`. |
| `createDelegationStatusHandler` | function | Build the MCP tool handler that polls a `DelegationTaskQueue` for task status. |
| `createDelegationTraceCollector` | function | Build a `DelegationTraceCollector` that buffers loop-trace events and converts them to spans on settle. |
| `createDetachedTurnResumeDriver` | function | Build the `driveTurn`-backed {@link DelegationResumeDriver}. Each `tick()` |
| `createFleetWorkspaceExecutor` | function | Build an executor that resolves each delegated iteration to an existing |
| `createInProcessExecutor` | function | Build an in-process executor. Returns a {@link DelegationExecutor} whose `client.create()` |
| `createInProcessTransport` | function | In-process pair of `Readable` + `Writable` streams suitable for driving |
| `createKbGate` | function | Build a fail-closed KB gate. The returned function runs the built-in floor |
| `createMcpServer` | function | Stdio JSON-RPC MCP server exposing the delegation tools (`delegate`, `delegate_feedback`, `delegation_status`, `delegation_history`, optional `delegate_ui_audit`) to sandbox coding-harness agents. |
| `createPropagatingTraceEmitter` | function | Create a LoopTraceEmitter that: |
| `createSiblingSandboxExecutor` | function | Wrap a raw sandbox SDK client so the kernel emits |
| `createWorktree` | function | Checkout a fresh git worktree for a delegation run on a new branch under `variantsDir`. |
| `detachedSessionDelegate` | function | Build the sandbox-session coder delegate. It drives `runLoop` against the project's |
| `detachedTurnEvents` | function | Synthesize the terminal event array a detached turn settles through. Shaped |
| `detectExecutor` | function | Pick the right executor for an MCP server invocation based on env vars. |
| `eventToSnapshot` | function | Project a `FeedbackEvent` down to the snapshot shape carried on |
| `formatDetachedSessionRef` | function | Encode ref parts into the JSON-safe string stored on the record: |
| `hashIdempotencyInput` | function | Best-effort stable hash for use as `idempotencyKey`. Not cryptographic; |
| `liftFindings` | function | Lift validated raw rows into `AnalystFinding`s (agent-eval `makeFinding` stamps `finding_id`/ |
| `makeCheckRunner` | function | Build a `run_analyst` runner over a kind directory. |
| `mcpToolsForRuntimeMcp` | function | Returns the queue-bound delegation tools projected into OpenAI Chat |
| `mcpToolsForRuntimeMcpSubset` | function | Subset filter — return only the projected tools whose `function.name` |
| `parseDetachedSessionRef` | function | Parse a `detachedSessionRef` string back to parts; throws `ValidationError` on malformed input. |
| `readTraceContextFromEnv` | function | Read trace context from the process environment. |
| `removeWorktree` | function | Remove a git worktree and delete its branch; tolerates already-removed paths. |
| `renderTrace` | function | Render a worker's trace (tool calls + results) into the text an analyst lens reads. Generic over |
| `runCheck` | function | Run ONE lens over a trace → findings. Generic over any kind: prompt = the lens + the agent-eval |
| `runDetachedTurn` | function | Dispatch one detached turn and advance it to a terminal state with |
| `runLocalHarness` | function | Spawn a local coding harness CLI as a subprocess + collect its output. |
| `settleDetachedCoderTurn` | function | Settle a completed detached coder turn through the same gate the streaming |
| `traceContextToEnv` | function | Build env vars to pass to a child MCP subprocess so it inherits the |
| `validateDelegateArgs` | function | Parse and validate raw MCP tool input into typed `DelegateArgs`; throws `TypeError` on bad input. |
| `validateDelegateFeedbackArgs` | function | Parse and validate raw MCP tool input into typed `DelegateFeedbackArgs`; throws `TypeError` on bad input. |
| `validateDelegateUiAuditArgs` | function | Parse and validate raw MCP tool input into typed `DelegateUiAuditArgs`; throws `TypeError` on bad input. |
| `validateDelegationHistoryArgs` | function | Parse and validate raw MCP tool input into typed `DelegationHistoryArgs`; throws `TypeError` on bad input. |
| `validateDelegationStatusArgs` | function | Parse and validate raw MCP tool input into typed `DelegationStatusArgs`; throws `TypeError` on bad input. |
| `defaultChecks` | const | The built-in lens directory. Domain-blind (about any agent trace); compose at test time. |
| `DELEGATE_DESCRIPTION` | const | Human-readable description of the `delegate` MCP tool, injected into the tool manifest. |
| `DELEGATE_FEEDBACK_DESCRIPTION` | const | Human-readable description of the `delegate_feedback` MCP tool, injected into the tool manifest. |
| `DELEGATE_FEEDBACK_INPUT_SCHEMA` | const | JSON Schema for `delegate_feedback` tool arguments (`refersTo`, `rating`, `by`, optional fields). |
| `DELEGATE_FEEDBACK_TOOL_NAME` | const | MCP tool name for the `delegate_feedback` feedback-recording tool. |
| `DELEGATE_INPUT_SCHEMA` | const | JSON Schema for `delegate` tool arguments (`intent` + optional `model` and `runId`). |
| `DELEGATE_TOOL_NAME` | const | MCP tool name for the `delegate` generic-delegation tool. |
| `DELEGATE_UI_AUDIT_DESCRIPTION` | const | Human-readable description of the `delegate_ui_audit` MCP tool, injected into the tool manifest. |
| `DELEGATE_UI_AUDIT_INPUT_SCHEMA` | const | JSON Schema for `delegate_ui_audit` tool arguments (`workspaceDir`, `routes`, optional config). |
| `DELEGATE_UI_AUDIT_TOOL_NAME` | const | MCP tool name for the `delegate_ui_audit` async kickoff tool. |
| `DELEGATION_HISTORY_DESCRIPTION` | const | Human-readable description of the `delegation_history` MCP tool, injected into the tool manifest. |
| `DELEGATION_HISTORY_INPUT_SCHEMA` | const | JSON Schema for `delegation_history` tool arguments (optional `namespace`, `profile`, `since`, `limit`). |
| `DELEGATION_HISTORY_TOOL_NAME` | const | MCP tool name for the `delegation_history` read-past-delegations tool. |
| `DELEGATION_STATUS_DESCRIPTION` | const | Human-readable description of the `delegation_status` MCP tool, injected into the tool manifest. |
| `DELEGATION_STATUS_INPUT_SCHEMA` | const | JSON Schema for `delegation_status` tool arguments (`taskId` + optional `includeTrace`). |
| `DELEGATION_STATUS_TOOL_NAME` | const | MCP tool name for the `delegation_status` synchronous-poll tool. |
| `DELEGATION_TRACE_MAX_BYTES` | const | Default cap on the serialized trace payload per record, in bytes. |
| `DELEGATION_TRACE_MAX_SPANS` | const | Default cap on spans retained per delegation record. |
| `DelegationPersistenceError` | class | A delegation-store read or write failed (filesystem error, store |
| `DelegationStateCorruptError` | class | The persisted delegation state exists but cannot be parsed into |
| `DelegationTaskQueue` | class | In-process queue for async delegation tasks — submit, cancel, poll status, and read history. |
| `FileDelegationStore` | class | JSON-file persistence for the delegation queue. Each write serializes |
| `InMemoryDelegationStore` | class | In-memory `DelegationStore` — suitable for single-process use and tests. |
| `InMemoryFeedbackStore` | class | In-memory `FeedbackStore` — suitable for single-process use and tests. |
| `Check` | interface | One lens — a composable analyst kind. Identity fields mirror `TraceAnalystKindSpec` so a kind is |
| `CoordinationTools` | interface | The supervisor-side toolbox returned by {@link createCoordinationTools}: the MCP tool |
| `DelegateArgs` | interface | Parsed `delegate` tool arguments. |
| `DelegateCodeConfig` | interface | Minimal `CoderTask` overrides exposed over the MCP wire. The full |
| `DelegateUiAuditRoute` | interface | Optional per-route capture spec the agent surfaces over the wire. |
| `DelegationRecord` | interface | Must be JSON-safe end to end (`args`, `result`, `error`, `feedback`) — |
| `DelegationResumeDriver` | interface | Re-attaches restored in-flight records to their detached runs. The queue |
| `DelegationTraceCollector` | interface | Per-delegation trace collector. Buffers `LoopTraceEvent`s per runId |
| `DelegationTraceSpan` | interface | One span of a delegation's compact trace. Flat (parent linkage by id), all |
| `DetachedSessionRefParts` | interface | Decoded `DelegationRecord.detachedSessionRef`. `sandboxId` is absent between |
| `DriveTurnCapableBox` | interface | The box surface detached turns need. `SandboxInstance` |
| `FleetHandle` | interface | Minimal `SandboxFleet` surface the fleet executor calls. Declared |
| `ResearchOutputShape` | interface | Loose shape of a research output over the wire — the substrate cannot |
| `SettledWorker` | interface | A worker the driver has drained via `await_event`. |
| `TraceContext` | interface | Trace context propagation for MCP subprocess. |
| `UiAuditorDelegationOutput` | interface | Wire-shape of a completed UI-audit delegation. The `findings` array |
| `CoderReviewer` | type | Optional adversarial reviewer over a coder candidate that already passed |
| `CoordinationEvent` | type | Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for |
| `DelegateResult` | type | The synchronous result the `delegate` tool returns to the calling agent: the delivered output (or |
| `DelegationResultPayload` | type | Polymorphic `result` field: `CoderOutput` when the underlying profile |
| `DelegationResumeTick` | type | One observation of a detached run, mapped 1:1 from a single-tick driver |
| `DriveTurnTick` | type | Structural mirror of the sandbox SDK's `TurnDriveResult` (>= 0.6). |
| `GitRunner` | type | Pluggable git runner (sync) — replaceable in tests. |
| `LocalHarness` | type | Local coding harness available inside the sandbox. |
| `UiAuditorDelegate` | type | UI-auditor delegate — fully consumer-injected. agent-runtime ships no |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AnalystRegistry`, `CappedDelegationTrace`, `CheckRunnerOptions`, `CoderReview`, `CoordinationToolsOptions`, `CreateKbGateOptions`, `CreateWorktreeOptions`, `DelegateCodeArgs`, `DelegateCodeResult`, `DelegateFeedbackArgs`, `DelegateFeedbackResult`, `DelegateHandlerOptions`, `DelegateResearchArgs`, `DelegateResearchConfig`, `DelegateResearchResult`, `DelegateRunCtx`, `DelegateUiAuditArgs`, `DelegateUiAuditConfig`, `DelegateUiAuditResult`, `DelegationError`, `DelegationExecutor`, `DelegationFeedbackSnapshot`, `DelegationHistoryArgs`, `DelegationHistoryEntry`, `DelegationHistoryResult`, `DelegationProgress`, `DelegationResumeContext`, `DelegationRunContext`, `DelegationStatusArgs`, `DelegationStatusResult`, `DelegationStore`, `DelegationTaskQueueOptions`, `DelegationTraceCaps`, `DetachedSessionDelegateOptions`, `DetachedTurn`, `DetachedTurnResumeDriverOptions`, `DetectExecutorArgs`, `DiffOptions`, `DiffResult`, `FactCandidate`, `FactJudge`, `FactJudgeVerdict`, `FeedbackEvent`, `FeedbackRating`, `FeedbackRefersTo`, `FeedbackStore`, `FileDelegationStoreOptions`, `FleetWorkspaceExecutorOptions`, `InProcessExecutorDescribePlacement`, `InProcessExecutorOptions`, `JsonRpcMessage`, `JsonRpcResponse`, `KbGateResult`, `LocalHarnessResult`, `McpServer`, `McpServerOptions`, `McpToolDescriptor`, `McpTransport`, `Question`, `QuestionRecord`, `RemoveWorktreeOptions`, `RunDetachedTurnOptions`, `RunLocalHarnessOptions`, `SettleDetachedCoderTurnOptions`, `SiblingSandboxExecutorOptions`, `SubmitInput`, `SubmitOutput`, `WorktreeHandle`, `CoderDelegate`, `DelegationProfile`, `DelegationStatus`, `DetachedWinnerSelection`, `MakeWorkerAgent`, `QuestionDecision`, `QuestionPolicy`, `ResearchSource`.

## 2. agent-eval — substrate primitives to REUSE

The scoring/measurement/judge substrate. **Do NOT re-implement a judge, an authenticity check, a verifier, a statistics routine, a profile-matrix runner, or usage extraction** — import them from here. The category→subpath mapping is curated; the symbols are generated.

### JUDGE — LLM-as-judge, panels, calibration

Import from `@tangle-network/agent-eval` — 30 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `buildAgreementJudge` | function | Build a `JudgeConfig` that scores a produced student artifact against the |
| `cachedJudge` | function | Wrap a `JudgeConfig` so repeat judgments of the same artifact are served |
| `calibrateJudge` | function | Measure judge quality against human gold labels: computes Cohen's κ, Pearson correlation, and MAE over matched item ids. |
| `compilerJudge` | function | Build a `SandboxJudgeSpec` that scores whether the harness compiles without errors. |
| `contractJudge` | function | Adapt trace contracts to a campaign `JudgeConfig`. One judge dimension per |
| `createAntiSlopJudge` | function | Create a reusable Judge function from an anti-slop config. |
| `createCustomJudge` | function | Create a custom judge with a fully custom prompt. |
| `createDomainExpertJudge` | function | Create a domain expert judge with a configurable domain. |
| `createIntentMatchJudge` | function | Factory: pin LLM options once, return a closure. |
| `createSemanticConceptJudge` | function | Factory: pin LLM options once, return a closure that accepts inputs. |
| `ensembleJudge` | function | Build a campaign-shaped `JudgeConfig` whose `score()` runs every panel |
| `judgeFamily` | function | Classify a model id into its provider family. Strips a `@snapshot` suffix |
| `judgeReplayGate` | function | Confirm a candidate's win with a stronger judge: score baseline and candidate outputs independently, then bootstrap a CI to verify the lift generalises beyond the inner loop. |
| `judgeSpans` | function | Query judge-kind spans from the trace store, optionally scoped to a single run. |
| `linterJudge` | function | Build a `SandboxJudgeSpec` that scores the harness by linter rule violations. |
| `llmJudge` | function | Build a campaign-shaped `JudgeConfig` whose `score()` makes ONE LLM call |
| `replayTraceThroughJudge` | function | Apply a judge function to every LLM span in a run and record the |
| `runIntentMatchJudge` | function | Run the intent-match judge. Soft-fails to available=false on error. |
| `runKeywordCoverageJudge` | function | Score expected concepts against an already-fetched HTML payload + any |
| `runSemanticConceptJudge` | function | Run the semantic concept judge. Soft-fails to available=false on |
| `securityJudge` | function | Build a `SandboxJudgeSpec` that scores the harness output for security issues via a security scanner. |
| `testJudge` | function | Build a `SandboxJudgeSpec` that scores the harness by its test-suite pass rate. |
| `traceJudge` | function | Wrap a single JudgeFn so its LLM call emits a traced span. |
| `adversarialJudge` | const | Adversarial judge — red-teams agent responses. |
| `codeExecutionJudge` | const | Code execution judge — evaluates whether code blocks are valid and runnable. |
| `coherenceJudge` | const | Coherence judge — evaluates multi-turn consistency and progression. |
| `CachedJudge` | type | The wrapped judge: same `JudgeConfig` seam, plus hit/miss observability. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `CalibrationResult`, `ContinuousCalibrationResult`, `JudgeConfig`.

### AUTHENTICITY — is-this-real / anti-Goodhart gate

Import from `@tangle-network/agent-eval/authenticity` — 14 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `gateRealness` | function | Anti-Goodhart gate: a required-artifact-missing or faked submission is |
| `judgeRealnessLlm` | function | Ask an LLM to rate realness DIRECTLY on a 0-100 scale — the axis that matched |
| `scoreAuthenticity` | function | Deterministic authenticity scan of produced files. Pure — same files in, |
| `scoreAuthenticityNuance` | function | LLM nuance scoring — judges the "looks real but is hollow" axis structure |
| `scoreRealnessBlended` | function | Score realness using the cheapest sufficient signal: trust the deterministic |
| `ProducedFile` | interface | Authenticity — "is this real, or convincing BS?" |
| `CompleteFn` | type | A minimal completion fn — inject your model caller (router/tcloud). Keeps |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AuthenticityNuance`, `AuthenticityResult`, `AuthenticitySignals`, `BlendedRealness`, `RealnessGate`, `RealnessJudgment`, `RealnessBand`.

### VERIFICATION — multi-layer verifier + semantic grading

Import from `@tangle-network/agent-eval` — 10 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `gradeSemanticStatus` | function | Grade a semantic-concept-style judge result into a single layer status. |
| `verifyAgentProfileCell` | function | Verify an `AgentProfileCell`'s `cellId` matches the sha256 of its hash-material fields, confirming the record has not been tampered with. |
| `verifyAttestation` | function | Verify a report against its attestation. Returns a typed outcome rather |
| `verifyCompletion` | function | Verify whether a run completed the task. `checkCorrectness` is injected — |
| `verifyManifest` | function | Verify that a signed manifest has not been tampered with. |
| `MultiLayerVerifier` | class | Ordered DAG of verification layers with dependency-based skipping, per-layer findings, soft-fail semantics, and a blended composite score across all passed layers. |
| `VerificationReport` | interface | Extends the substrate verdict spine: `valid` = `allPass` and `score` = |
| `LayerStatus` | type | Multi-layer verifier — ordered pipeline of verification layers. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `Finding`, `VerifyOptions`.

### STATISTICS — significance, intervals, effect size

Import from `@tangle-network/agent-eval` — 49 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `benjaminiHochberg` | function | Benjamini–Hochberg false discovery rate. Returns adjusted q-values and |
| `bonferroni` | function | Bonferroni adjustment: multiply every p-value by the test count, clamp at 1. |
| `cliffsDelta` | function | Cliff's delta — a non-parametric effect size for two independent samples. |
| `cohensD` | function | Cohen's d — standardized effect size for two independent groups. |
| `confidenceInterval` | function | Bootstrap confidence interval |
| `corpusInterRaterAgreement` | function | Corpus-wide inter-rater agreement across N items × M judges × D dimensions. |
| `corpusInterRaterAgreementFromJudgeScores` | function | Convenience adapter for `JudgeScore[]` data keyed externally by item. |
| `eProcess` | function | Betting test-martingale for bounded observations — the e-process core of |
| `interpretCliffs` | function | Map a Cliff's delta to a qualitative magnitude using the standard |
| `interRaterReliability` | function | Inter-rater reliability — simplified Krippendorff's alpha. |
| `mannWhitneyU` | function | Mann-Whitney U test for comparing two independent groups. |
| `mcnemar` | function | McNemar's test for paired binary outcomes — the correct significance test for |
| `mcnemarPower` | function | Power of a McNemar test at a given number of paired observations, the inverse |
| `mcnemarRequiredN` | function | Number of paired observations needed for a McNemar test to reach a target |
| `mulberry32` | function | Tiny seedable PRNG (mulberry32) — deterministic resampling/shuffling, not |
| `pairedBootstrap` | function | Paired bootstrap on (after − before) deltas. Returns a CI on the chosen |
| `pairedEvalueSequence` | function | Run the paired e-value sequence over an in-order delta stream. |
| `pairedMde` | function | Minimum detectable paired effect (standardised units) for a target paired |
| `pairedRiskDifference` | function | Paired risk difference (the effect-size companion to {@link mcnemar}): the |
| `pairedTTest` | function | Paired t-test — before/after measurements on the SAME items. |
| `partialCredit` | function | Partial credit: returns 0-1 ratio of current toward target |
| `passAtK` | function | Unbiased pass@k for code generation (Chen et al. 2021, "Evaluating Large |
| `pearsonR` | function | Pearson product-moment correlation coefficient r ∈ [-1, 1] between two |
| `ranks` | function | Average-rank-with-ties transform (1-indexed). Tied values receive the mean |
| `requiredSampleSize` | function | Required N per arm for a two-sample comparison at target effect size, |
| `spearmanR` | function | Spearman's rank correlation ρ — Pearson over the average-rank-with-ties |
| `weightedComposite` | function | Weighted composite over judge dimensions: `Σ(score_d · w_d) / Σ(w_d)` across |
| `weightedMean` | function | Weighted mean — falls back to uniform weights when omitted |
| `wilcoxonSignedRank` | function | Wilcoxon signed-rank test — paired non-parametric alternative. |
| `wilson` | function | Wilson score interval for a binomial proportion. Correct at small n and near |
| `normalizeScores` | const | Identity: dimensions already follow "higher = better" by prompt convention |
| `McNemarResult` | interface | Result of a McNemar paired-binary significance test. |
| `ProportionInterval` | interface | A binomial proportion estimate with a confidence interval. |
| `RiskDifferenceResult` | interface | A paired binary effect size (treatment rate − control rate) with a CI. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `BootstrapOptions`, `BootstrapResult`, `CorpusAgreementOptions`, `CorpusAgreementPerDimension`, `CorpusAgreementReport`, `CorpusScoreRecord`, `EProcess`, `EProcessOptions`, `EProcessState`, `EProcessStep`, `PairedBootstrapOptions`, `PairedBootstrapResult`, `WeightedCompositeInput`, `WeightedCompositeResult`, `CliffsMagnitude`.

### CAMPAIGN — profile matrix, gates, improvement loop

Import from `@tangle-network/agent-eval/campaign` — 261 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `aceProposer` | function | Append-only context engineering proposer: grows a skill playbook by appending generation-tagged lessons without merging or overwriting prior entries. |
| `applySkillPatch` | function | Apply a SkillOpt patch to a text surface. Ops apply in array order against |
| `buildAnalystSurfaceDispatch` | function | Build the `dispatchWithSurface(surface, scenario, ctx)` the improvement loop |
| `buildEvidenceVector` | function | The Evidence Bus. For each objective, pair candidate vs baseline by full |
| `buildLoopProvenanceRecord` | function | Build the durable provenance record from a completed loop result. |
| `callbackGovernor` | function | The LLM-supervisor slot: a governor whose `decide` defers to a caller-supplied |
| `campaignBreakdown` | function | Per-candidate evidence a reflective/patch proposer grounds its next proposal |
| `campaignMeanComposite` | function | Mean composite across a campaign: per cell, the mean of its judges' |
| `compareProposers` | function | Run a head-to-head lift benchmark across surface proposers on a shared holdout, returning per-proposer lift CIs and pairwise "who wins" verdicts. |
| `composeGate` | function | Compose gates — all must `ship` for the composite to `ship`. First |
| `countSentenceEdits` | function | Sentence-level edit distance — count distinct add/remove ops between |
| `defaultProductionGate` | function | Opinionated production gate composing held-out significance, red-team, reward-hacking, and canary checks into a single `Gate.decide` decision. |
| `defaultRenderDiff` | function | Default surface diff renderer: produces a unified baseline/winner text diff for prompt surfaces or a worktree-ref summary for code surfaces. |
| `detectScale` | function | Detect the native scale of a set of scores: 0-100 when any magnitude clears |
| `dimensionRegressions` | function | Per-critical-dimension regression guard. For each dimension, pair the |
| `discoverEvalFixtures` | function | Walk `evalsDir` and return the relative name of every fixture directory (one containing an exact-case `PROMPT.md`). |
| `emitLoopProvenance` | function | Build the provenance record + OTel spans and persist them durably under the |
| `evolutionaryProposer` | function | Wrap a stateless `Mutator` (GEPA, AxGEPA, reflective-mutation) as a `SurfaceProposer` that mutates the current best surface into N candidates each generation. |
| `extractFapoAttributionSignals` | function | Scan a findings array and extract FAPO attribution signals — per-level counts and failure clusters used to decide which optimization level to escalate to next. |
| `extractH2Sections` | function | Extract H2 headings (`## Foo`) from a markdown surface. Exported for |
| `failureModeRecallJudge` | function | Deterministic, ground-truth judge for analyst findings. Composite = |
| `fapoEscalationEntry` | function | Build a `ProposerEntry` that runs the full FAPO escalation policy (prompt → parameter → structural) as a single comparable optimizer entry. |
| `fapoProposer` | function | Build a FAPO policy proposer from level-specific candidate generators. |
| `fsCampaignStorage` | function | Node-filesystem storage — the default. Lazily requires `node:fs` so the |
| `fsLineageStore` | function | JSONL-file store: append-only durability, snapshot via rewrite, `load` parses |
| `gepaParetoEntry` | function | GEPA with the Pareto frontier + combine-complementary-lessons. |
| `gepaProposer` | function | GEPA reflective proposer: each generation reflects on the weakest scenarios and dimensions to produce targeted prompt rewrites, optionally combining Pareto-frontier parents. |
| `gepaReflectionEntry` | function | GEPA, reflection-only (single-parent, no Pareto combine). |
| `gitWorktreeAdapter` | function | Git-backed `WorktreeAdapter`: creates isolated worktrees on fresh branches, commits agent changes, and discards losers. |
| `haloProposer` | function | Wrap the real halo-engine CLI as a SurfaceProposer (prompt-tier). |
| `heldOutGate` | function | Composable held-out gate: ships only when the PAIRED bootstrap CI lower bound |
| `heldoutSignificance` | function | Significance of the held-out composite lift: ship only when the paired |
| `heuristicGovernor` | function | The reference deterministic policy an agent {@link Governor} can replace. |
| `inMemoryCampaignStorage` | function | In-memory storage for filesystem-less runtimes. Artifacts + trace spans |
| `isProposedCandidate` | function | Type guard: a proposal carrying its rationale vs a bare |
| `labelTrustRank` | function | Ordinal rank for a label-trust tier; absent ⇒ `unverified` (rank 0). |
| `lineageNodeId` | function | Deterministic node id: a hash of the node's lineage + content + proposer. |
| `llmJudge` | function | Build a campaign-shaped `JudgeConfig` whose `score()` makes ONE LLM call |
| `loadEvalFixture` | function | Load ONE fixture by name: reads `PROMPT.md` (plus `EVAL.ts`/`EVAL.tsx` and `package.json` under |
| `loadEvalFixtureScenarios` | function | Load fixtures (all discovered, or just `names`) as campaign `Scenario`s tagged `eval-fixture`. |
| `loopProvenanceSpans` | function | Build the loop's OTLP-ingestable spans from a provenance record. One root |
| `makePlaybackDispatch` | function | Adapt a `PlaybackDriver` into a `runProfileMatrix` dispatch. The artifact the |
| `memLineageStore` | function | In-memory store (default; for tests and ephemeral runs). |
| `memoryCurationProposer` | function | Build the CURATOR proposer. |
| `neutralizationGate` | function | Composable placebo gate: ships only when the candidate's held-out lift is NOT |
| `neutralizeText` | function | Blank every non-whitespace character to a 1-byte filler while preserving all |
| `openAutoPr` | function | Open a GitHub PR for a gate-approved surface promotion, attaching the manifest hash, gate verdict, and diff as the PR body. |
| `pairHoldout` | function | Pair candidate vs baseline holdout observations by FULL cellId. `select` |
| `parameterSweepProposer` | function | Config/parameter-level proposer for FAPO's middle escalation level. |
| `paretoSignificanceGate` | function | Wrap the bus + a policy as a `Gate`. Plugs into the existing |
| `parseSkillPatchResponse` | function | Parse a SkillOpt LLM response into validated `SkillPatch` objects, throwing `SkillPatchParseError` on malformed JSON and silently dropping ops that violate the edit budget. |
| `patchEditCount` | function | Total ops in a patch — the edit-budget axis (SkillOpt's "textual learning |
| `planCampaignRun` | function | Plan a campaign WITHOUT dispatching: computes the manifest hash and the per-cell |
| `planEvalFixtureRun` | function | Dry-run planner for a fixture campaign: loads the scenarios, delegates to `planCampaignRun`, |
| `policyEditProposer` | function | `SurfaceProposer` that admission-checks typed analyst `PolicyEdit`s and applies each |
| `powerPreflight` | function | Estimate the minimum detectable lift a paired-holdout improvement run can |
| `provenanceRecordPath` | function | Canonical durable paths under the run dir. |
| `provenanceSpansPath` | function | Canonical path for the durable OTLP spans JSONL file under a loop run directory. |
| `renderScoreboardMarkdown` | function | Render the scoreboard as a launch-readiness Markdown document — the literal |
| `resolveRunDir` | function | Resolve a campaign `runDir`. An absolute path is honored as-is (the caller |
| `resolveWorktreePath` | function | Resolve a `CodeSurface`'s worktreeRef to a directory the measurement can |
| `runCampaign` | function | Core campaign orchestrator: fan scenarios through dispatch, score with judges, aggregate bootstrap CIs, and persist reproducible `CampaignResult` records. |
| `runEval` | function | Simplest evaluation preset: run scenarios through dispatch, score with judges, and return a `CampaignResult` — no optimizer, no gate, no PR. |
| `runImprovementLoop` | function | Gated-promotion shell over `runOptimization`: scores the winner against the baseline on a holdout set, runs the release gate, and optionally opens a PR. |
| `runLineage` | function | Drive a multi-track improvement DAG under an agent-managed governor. Seeds each |
| `runLineageLoop` | function | Wire the {@link runLineage} DAG's `step`/`merge` seams to a real |
| `runOptimization` | function | Improvement loop body: N generations of propose → campaign → rank, maintaining a Pareto frontier and promoting the top-scoring candidates to the next generation. |
| `runProfileMatrix` | function | Profile × scenario matrix runner: fan N agent profiles across M scenarios, project each cell to a validated `RunRecord` with real token usage, and enforce the backend-integrity guard before returning. |
| `runSkillOpt` | function | SkillOpt sequential hill-climb: each epoch reflects on train-scenario weaknesses, proposes bounded patches, accepts the first patch that strictly improves the held-out composite, and anneals the edit  |
| `scoreboardSummary` | function | Roll the per-requirement rows up into the launch headline counts. |
| `scoreDiscrimination` | function | Rank scenarios by how well they DISCRIMINATE candidates. |
| `scoreUserStory` | function | Score one story's produced state against its requirements. Thin wrapper over |
| `selectDiscriminative` | function | Select the top-`k` most discriminative scenario ids for a holdout, EXCLUDING |
| `sequentialDecide` | function | `SurfaceProposer.decide` adapter — stops the optimization loop the moment |
| `sequentialPairedGate` | function | Anytime-valid sequential paired gate. Conforms to the existing `Gate` |
| `skillOptEntry` | function | SkillOpt patch-mode hill-climb. Runs findings-BLIND: `runSkillOpt` owns its |
| `skillOptProposer` | function | SkillOpt proposer: proposes bounded, anchored patch operations (add/delete/replace) on a skill document, conforming to both the patch-native `SkillOptProposer` and the generic `SurfaceProposer` interf |
| `surfaceContentHash` | function | Stable sha256 (full hex) of a surface's effective text. Code surfaces hash |
| `surfaceHash` | function | Short (16-char) sha256 fingerprint of a `MutableSurface`: hashes text content for prompt surfaces, or the worktree + base ref pair for code surfaces. |
| `tangleTracesRoot` | function | The shared, out-of-repo root for campaign/benchmark run bundles. Keeping run |
| `traceAnalystProposer` | function | Wrap agent-eval's trace-analyst registry as a SurfaceProposer (prompt-tier). |
| `userStoryScoreboard` | function | Flatten story verdicts into the per-requirement scoreboard — the literal |
| `paretoPolicy` | const | The default strategy: symmetric multi-objective Pareto significance. Ship iff |
| `FsLabeledScenarioStore` | class | Filesystem `LabeledScenarioStore`: appends one JSONL file per source with provenance and |
| `LabeledScenarioStoreError` | class | Typed rejection from a labeled-scenario store (bad provenance, rate limit, invalid sample args) — carries a stable string `code`. |
| `Lineage` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `ProfileMatrixError` | class | Thrown when the matrix is misconfigured (no profiles, a profile whose model |
| `SkillPatchParseError` | class | Parse + validate the patch response. Throws `SkillPatchParseError` when the |
| `WorktreeAdapterError` | class | Typed failure from a `WorktreeAdapter` operation (create/finalize/discard) — wraps the underlying git error as `cause`. |
| `AceProposerOptions` | interface | `aceProposer` — Agentic Context Engineering: an APPEND-MOSTLY curator, the |
| `AnalystArtifact` | interface | The analyst's output for one scenario — the artifact the judge scores. |
| `AnalystScenario` | interface | A labeled trace scenario: a FIXED trace corpus plus the failure modes a |
| `CampaignArtifactWriter` | interface | Scoped artifact writer — `write(path, content)` lands under |
| `CampaignCostMeter` | interface | Cell-scoped cost meter. NOTHING is captured automatically — |
| `CampaignStorage` | interface | `CampaignStorage` — the filesystem seam `runCampaign` writes through |
| `CampaignTraceWriter` | interface | Scoped trace writer handed to each dispatch — every span |
| `CodeSurface` | interface | A tier-4 code surface — a candidate change to the agent's |
| `DefaultProductionGateOptions` | interface | `defaultProductionGate` — composes the substrate's existing safety |
| `DispatchContext` | interface | Context handed to every dispatch invocation. Scoped — every |
| `EvolutionaryProposerOptions` | interface | `evolutionaryProposer` — adapts a stateless `Mutator` (population mutation: |
| `FapoEntryConfig` | interface | FAPO reviewed-escalation policy. This is an orchestration layer over |
| `FsLabeledScenarioStoreOptions` | interface | Filesystem `LabeledScenarioStore` adapter. The default capture sink for |
| `Gate` | interface | Composable promotion gate. |
| `GenerationCandidate` | interface | One scored candidate surface in a generation. `dimensions` + `scenarios` |
| `GepaProposerConstraints` | interface | `gepaProposer` — a reflective `SurfaceProposer` for prompt-tier surfaces. |
| `HaloProposerOptions` | interface | `haloProposer` — wraps the REAL halo-engine (Inference.net's hierarchical |
| `JudgeConfig` | interface | Pluggable dimensional scorer. `score` is the contract: |
| `JudgeScore` | interface | The canonical judge verdict shape — one declaration, shared by campaign |
| `LabeledScenarioWrite` | interface | Required-provenance write. The store rejects writes that |
| `LineageNode` | interface | Lineage DAG — a git-graph of improvement candidates. |
| `LoopProvenanceRecord` | interface | The durable provenance record. Aligns to the hosted `EvalRunEvent` path but |
| `MemoryCurationProposerOptions` | interface | `memoryCurationProposer` — a CURATOR `SurfaceProposer`, the complement to the |
| `Mutator` | interface | Stateless surface mutation — given findings + current |
| `OpenAutoPrOptions` | interface | `openAutoPr` — thin shell-out helper for the `runImprovementLoop` preset's |
| `OptimizerEntryConfig` | interface | Shared corpus + transport for the three built-in optimizer entries. |
| `PairedHoldout` | interface | Statistical held-out promotion machinery — the trustworthy core the |
| `ParetoParent` | interface | A non-dominated parent on the GEPA Pareto frontier — a |
| `PlaybackContext` | interface | Dispatch context plus the profile under test (which cheap model, etc.). |
| `PlaybackDriver` | interface | Drives the real product through a story and returns the runtime event stream |
| `PlaybackStep` | interface | One step of a user story — what the user does. The driver interprets |
| `PolicyEditProposerOptions` | interface | `policyEditProposer` turns typed analyst policy edits into measured candidate |
| `PowerPreflightOptions` | interface | Power preflight — "can this budget detect the effect you are hunting?" |
| `ProposeContext` | interface | Everything a proposer may read to plan the next |
| `ProposedCandidate` | interface | A proposer output carrying the surface AND the WHY behind |
| `ProposerEntry` | interface | What an optimizer produced: the surface it promoted + what it cost to get |
| `RejectedEdit` | interface | A patch that was tried and not accepted — fed back to the model so it does |
| `RunCampaignOptions` | interface | `runCampaign` — Pass A substrate primitive. ONE function that orchestrates |
| `RunEvalOptions` | interface | `runEval` — the simplest preset over `runCampaign`. No optimizer, no |
| `RunLineageLoopSeed` | interface | A seed track: the initial surface + track identity. Unlike |
| `RunSkillOptOptions` | interface | `runSkillOpt` — the SkillOpt epoch hill-climb (Microsoft, arXiv:2605.23904). |
| `Scenario` | interface | Stable identifier + kind tag for any scenario. Consumers |
| `ScenarioSignal` | interface | Per-scenario observation: the composite scores each candidate earned on it. |
| `ScoreboardRow` | interface | One row of the launch scoreboard — story × requirement → PASS/FAIL. |
| `ScoreboardSummary` | interface | Launch-readiness headline counts rolled up from the per-requirement rows. |
| `SessionScript` | interface | One session within a multi-session journey. Dispatch is |
| `SkillOptEvidence` | interface | Evidence the optimizer reflects on: where the current surface is weakest. |
| `SkillPatch` | interface | A named, attributable bundle of ops the optimizer proposes as one edit. |
| `SurfaceProposer` | interface | A surface-improvement strategy. Given the current best |
| `SurfaceScore` | interface | The measured fitness of one surface — the value recorded on a DAG node. |
| `TraceAnalystProposerOptions` | interface | `traceAnalystProposer` — wraps agent-eval's OWN trace-analyst engine |
| `UserStory` | interface | A user story = a runnable product journey plus the requirements that define |
| `UserStoryVerdict` | interface | A scored user story — the completion verdict plus its human title. |
| `Worktree` | interface | VCS-pluggable worktree adapter. One improvement = one worktree, PR-like |
| `AxisVerdict` | type | Per-axis verdict from the good-direction paired bootstrap. |
| `CampaignTokenUsage` | type | Token usage accumulated for a cell. Aliased to the canonical `RunTokenUsage` |
| `DispatchFn` | type | One function: scenario + ctx → artifact. Dispatcher chooses |
| `FapoOptimizationLevel` | type | FAPO (Fully Autonomous Prompt Optimization) is an orchestration policy, not |
| `GateDecision` | type | Five-valued verdict taxonomy (MOSS-paper alignment). |
| `LabeledScenarioSource` | type | Source tag — required on every store write. Used by the |
| `LabelTrust` | type | How much a label can be trusted to evaluate against — the gold-admission |
| `LineageNodeInput` | type | Input to {@link Lineage.addNode}: everything but the derived `id`/`seq` and the |
| `LlmJudgeDimension` | type | A rubric dimension as a bare key or the full `{ key, description }` shape. A |
| `MutableSurface` | type | The mutable surface a proposer changes. Tiers (see |
| `ObjectiveSource` | type | Where an objective's per-cell scalar comes from. `composite` reads the |
| `OptimizationProposer` | type | Optional vocabulary alias. The loop is the optimizer; this object is the |
| `ProfileDispatchFn` | type | Dispatch for one cell: render `profile` against `scenario`, returning the |
| `PromotionPolicy` | type | A promotion strategy: a pure function from the evidence vector to a verdict. |
| `RunImprovementLoopOptions` | type | `runImprovementLoop` — the gated-promotion shell around the improvement |
| `SequentialDecision` | type | Anytime-valid sequential promotion gate — an e-process (betting |
| `SkillPatchOp` | type | A single bounded edit against a skill surface. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AcceptedEdit`, `ApplySkillPatchResult`, `AxisEvidence`, `BuildAnalystSurfaceDispatchOptions`, `BuildEvidenceVectorOptions`, `BuildLoopProvenanceArgs`, `CampaignAggregates`, `CampaignBreakdown`, `CampaignCellResult`, `CampaignResult`, `CampaignRunPlan`, `CampaignRunPlanCell`, `CompareProposersOptions`, `DimensionRegression`, `DiscriminationScore`, `EmitLoopProvenanceArgs`, `EmitLoopProvenanceResult`, `EvalFixture`, `EvalFixtureFile`, `EvalFixtureLoadOptions`, `EvalFixtureScenario`, `EvidenceVector`, `FailureModeRecallJudgeOptions`, `FapoAttributionSignals`, `FapoFailureCluster`, `FapoProposerOptions`, `FapoReviewInput`, `FapoReviewIssue`, `FapoReviewResult`, `FapoScopeContract`, `GateContext`, `GateResult`, `GenerationRecord`, `GepaProposerOptions`, `GitWorktreeAdapterOptions`, `Governor`, `GovernorContext`, `HeldOutGateOptions`, `HeldoutSignificance`, `HeldoutSignificanceOptions`, `HeuristicGovernorOptions`, `JudgeAggregate`, `JudgeDimension`, `LabeledScenarioRecord`, `LabeledScenarioSampleArgs`, `LabeledScenarioStore`, `LineageEdge`, `LineageGraph`, `LineageStore`, `LlmJudgeOptions`, `LoadEvalFixtureScenariosOptions`, `LoopProvenanceBackend`, `LoopProvenanceCandidate`, `NeutralizationGateOptions`, `OpenAutoPrResult`, `OptimizerConfig`, `ParameterCandidate`, `ParameterChange`, `ParameterSweepProposerOptions`, `ParetoSignificanceGateOptions`, `PlanCampaignRunOptions`, `PlanEvalFixtureRunOptions`, `PowerPreflight`, `ProfileSummary`, `PromotionObjective`, `ProposePatchesArgs`, `ProposerComparison`, `ProposerPairwise`, `ProposerScore`, `RunImprovementLoopResult`, `RunLineageLoopOptions`, `RunLineageLoopResult`, `RunLineageOptions`, `RunLineageResult`, `RunLineageSeed`, `RunLineageStepResult`, `RunOptimizationResult`, `RunProfileMatrixOptions`, `RunProfileMatrixResult`, `RunSkillOptResult`, `ScenarioAggregate`, `ScenarioRollup`, `ScoreboardRenderOptions`, `SequentialDecideFn`, `SequentialDecideOptions`, `SequentialObservation`, `SequentialPairedGate`, `SequentialPairedGateOptions`, `SkillOptEpochRecord`, `SkillOptProposer`, `SkillOptProposerOptions`, `SkillPatchRejection`, `TraceSpan`, `WorktreeAdapter`, `EvalFixtureRunPlan`, `EvalFixtureValidationMode`, `GovernorOp`, `JsonPrimitive`, `JsonValue`, `RedactionStatus`, `RunOptimizationOptions`.

### TOKEN / USAGE — usage extraction + run-record usage types

Import from `@tangle-network/agent-eval` — 5 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `extractUsage` | function | Pull `{ input, output, cached? }` from a parsed chat-completions response |
| `extractUsageFromResponse` | function | Extract usage from an HTTP `Response` without consuming the caller's body: |
| `extractUsageFromSse` | function | Sum token usage across an SSE response body. Each `data:` line is parsed and |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `LlmUsage`, `RunTokenUsage`.
