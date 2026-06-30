<!--
  GENERATED — do not edit. Run `pnpm run docs:api` to regenerate.
  Source: scripts/gen-primitive-catalog.mjs reads the LIVE exports of this
  package + the @tangle-network/agent-eval substrate via the TypeScript compiler.
  A live export missing here = a RED BUILD (scripts/check-docs-freshness.mjs).
-->

# Primitive catalog — the never-stale anti-reinvention inventory

> **GENERATED** from `@tangle-network/agent-runtime@0.79.3` and `@tangle-network/agent-eval@0.100.0` by `scripts/gen-primitive-catalog.mjs`. Do NOT hand-edit — run `pnpm run docs:api`. This is the mechanical companion to the JUDGMENT in `canonical-api.md` (§2 decision table + §1.5 AgentProfile law): that doc says WHICH primitive to reach for and what NOT to build; this catalog proves WHAT exists. Per-symbol signatures + `file:line` live in the per-module pages under `docs/api/`.

## 1. agent-runtime — own public surface

Every subpath this package declares in `package.json` `exports`. Reach for these before hand-rolling a loop, driver, conversation runner, optimizer wrapper, or observability shim.

### Root — task lifecycle, conversation, RSI verbs, observability

Import from `@tangle-network/agent-runtime` — 208 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `agenticGenerator` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `applyRunRecordDefaults` | function | Stamp cross-cutting defaults onto adapter-projected RunRecords without |
| `auditLoopRunner` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `buildForwardHeaders` | function | Build the headers to emit on an outbound participant call, given the |
| `buildLoopOtelSpans` | function | Build a nested, real-duration OTLP span tree for ONE loop run from its full |
| `buildLoopSpanNodes` | function | Sink-neutral core behind {@link buildLoopOtelSpans}: reconstruct the |
| `cleanModelId` | function | Trim a candidate model id; `undefined` for non-strings and blanks. |
| `commandVerifier` | function | A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other |
| `composeRuntimeHooks` | function | Merge several {@link RuntimeHooks} into one. Falsy entries are dropped (so you can |
| `computeBackoff` | function | Compute the delay before the next attempt. Default: 250ms exponential with jitter. |
| `createConversationBackend` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createIterableBackend` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createOpenAICompatibleBackend` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createOtelExporter` | function | Create an OTEL exporter. Returns undefined when no endpoint is configured. |
| `createRuntimeEventCollector` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createRuntimeStreamEventCollector` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createSandboxPromptBackend` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `d1ToSqlAdapter` | function | Adapt a Cloudflare D1 binding to the SqlAdapter shape. Lives here so D1 |
| `decideKnowledgeReadiness` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `defineConversation` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `defineRuntimeHooks` | function | Identity helper that types a {@link RuntimeHooks} literal so the fields are inferred. |
| `deriveExecutionId` | function | Derive a stable executionId from the run identity. The same |
| `exportEvalRuns` | function | Ship self-improvement eval-run events to Tangle Intelligence. Unlike the |
| `getModels` | function | Fetch the model catalog from the router's `/v1/models`. Throws on a non-2xx |
| `handleChatTurn` | function | Run one chat turn. Returns immediately with a `ReadableStream` body; |
| `improve` | function | Run the held-out-gated self-improvement loop on ONE profile surface. |
| `improvementDriver` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `isDelegatedLoopMode` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `isDepthExceeded` | function | Refuse further forwarding when the inbound depth has reached the limit. |
| `loopEventToOtelSpan` | function | Convert a LoopTraceEvent into an OtelSpan for export. |
| `makePerAttemptSignal` | function | Build a per-attempt AbortSignal linked to the parent signal AND fired when |
| `mcpBuildPrompt` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `mcpServeVerifier` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `mcpToolsForRuntimeMcp` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `mcpToolsForRuntimeMcpSubset` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `notifyRuntimeDecisionPoint` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `notifyRuntimeHookEvent` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `parseLoopRunnerArgv` | function | Parse `--mode X --config Y` from an argv tail (`process.argv.slice(2)`). |
| `readDepth` | function | Read the depth counter off an inbound request. Missing → 0 (caller is the |
| `readinessServerSentEvent` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `reflectiveGenerator` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `researchLoopRunner` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `resolveChatModel` | function | Resolve a chat model by precedence: the first candidate carrying a |
| `resolveRouterBaseUrl` | function | Resolve the router base URL from env, normalised — no trailing `/v1` or `/`. |
| `runAgentTask` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runAgentTaskStream` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runConversation` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runConversationStream` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runDelegatedLoop` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runLoopRunnerCli` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runPersonaConversation` | function | Run one worker profile against one persona as a multi-round conversation. |
| `runPersonaDispatch` | function | Wrap {@link runPersonaConversation} as a `ProfileDispatchFn` for |
| `runtimeStreamServerSentEvent` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runToolLoop` | function | Run the bounded tool loop and return the final text + every executed tool |
| `sanitizeAgentRuntimeEvent` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `sanitizeKnowledgeReadinessReport` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `sanitizeRuntimeStreamEvent` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `selfImproveLoopRunner` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `sleep` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `slugifySpeaker` | function | Reduce a speaker name to ASCII alphanumerics + dashes. Preserves enough |
| `startRuntimeRun` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `streamToolLoop` | function | Streaming bounded tool loop: yields each raw turn event (the caller maps + |
| `toolBuildPrompt` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `turnId` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `validateChatModelId` | function | Validate a caller-supplied chat-model id. Rejects non-strings, malformed |
| `worktreeLoopRunner` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `DEFAULT_MAX_DEPTH` | const | Hard cap on chained gateway hops; refused beyond this. Default keeps recursion bounded. |
| `DEFAULT_ROUTER_BASE_URL` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `defaultIsRetryable` | const | Default retryable classification — network/timeout class errors. Errors |
| `DELEGATED_LOOP_MODES` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `FORWARD_HEADERS` | const | Standard names — lowercased so Headers maps interop on every runtime. |
| `INTELLIGENCE_WIRE_VERSION` | const | Wire version the eval-runs ingest enforces (X-Tangle-Wire-Version + body). |
| `AgentEvalError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `BackendTransportError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `CircuitBreakerState` | class | Live circuit-breaker state — one instance per (participant, conversation run). |
| `CircuitOpenError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `ConfigError` | class | Configuration missing or malformed (`HOME` unset, required image not supplied, env var absent). |
| `DeadlineExceededError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `FileConversationJournal` | class | JSONL on disk. One line per record; first line is the `begin`, subsequent |
| `InMemoryConversationJournal` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `InMemoryRuntimeSessionStore` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `JudgeError` | class | A judge call failed in a way that's not retryable: schema parse failure, bad rubric, conflicting dimensions. |
| `NotFoundError` | class | A named resource (run, span, rubric, scenario, dataset row, route) does not exist. |
| `PlannerError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeRunStateError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `SqlConversationJournal` | class | SQL-backed ConversationJournal. Two tables — runs (one row per runId, holds |
| `ValidationError` | class | Caller passed invalid arguments (out of range, mutually-exclusive options, bad shape). |
| `AgentAdapter` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentBackendContext` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentBackendInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentExecutionBackend` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgenticGeneratorOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentKnowledgeProvider` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentTaskContext` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentTaskRunResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentTaskSpec` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BackendCallPolicy` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BackendErrorDetail` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CandidateGenerator` | interface | The byte-producing seam — the ONE thing that differs between the cheap |
| `ChatStreamEvent` | interface | The NDJSON line protocol every product chat client already speaks. |
| `ChatTurnHooks` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ChatTurnIdentity` | interface | Identity of a chat turn. `tenantId` is the workspace id for workspace- |
| `ChatTurnProducer` | interface | The live side of a turn — what the product's `produce` hook returns. |
| `ChatTurnResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CircuitBreakerConfig` | interface | Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`. |
| `ControlBudget` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ControlEvalResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ControlRunResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ControlStep` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Conversation` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ConversationDriveState` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ConversationJournal` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ConversationJournalEntry` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ConversationParticipant` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ConversationPolicy` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ConversationResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ConversationTurn` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `D1DatabaseLike` | interface | Structural type matching the surface of `D1Database` we depend on, so the |
| `D1StmtLike` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DataAcquisitionPlan` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegatedLoopResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EvalRunEvent` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EvalRunGeneration` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EvalRunsExportConfig` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EvalRunsExportResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `HaltContext` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `HaltSignal` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ImprovementDriverOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ImproveOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ImproveResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `KnowledgeReadinessReport` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `KnowledgeRequirement` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopRunnerCliArgs` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopRunnerCliResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopSpanNode` | interface | Sink-neutral node in a reconstructed loop span tree. The root node's |
| `McpServeSpec` | interface | `mcpServeVerifier` — the intrinsic verifier for a built MCP server: the |
| `ModelInfo` | interface | A model entry as returned by the Tangle Router `/v1/models` endpoint. |
| `OpenAIChatTool` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `OtelAttribute` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `OtelExportConfig` | interface | OTEL span exporter — streams LoopTraceEvents to an OTLP/HTTP collector. |
| `OtelExporter` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `OtelSpan` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `PersonaConversationResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ReflectiveGeneratorOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ResearchLoopResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ResearchLoopRunnerOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ResolvedChatModel` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RouterEnv` | interface | Env keys the router base URL is resolved from. |
| `RunChatTurnInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunConversationOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunDelegatedLoopOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunPersonaConfig` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunPersonaConversationOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunRecord` | interface | Mandatory paper-grade fields for a single evaluation run. Optional |
| `RuntimeDecisionEvidenceRef` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeDecisionPoint` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeEventCollector` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeHookContext` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeHookErrorContext` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeHookEvent` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeHooks` | interface | The observation seam attached to a running loop (never to the portable genome). |
| `RuntimeRunHandle` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeRunPersistenceAdapter` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeRunRow` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeSessionStore` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeStreamEventCollector` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeTelemetryOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunToolLoopOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SanitizedKnowledgeReadinessReport` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SqlAdapter` | interface | Minimal SQL driver shape. Implementations forward to whichever client the |
| `StreamToolLoopOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ToolLoopAssistantToolCall` | interface | One OpenAI-shaped tool-call entry carried on an assistant message. |
| `ToolLoopCall` | interface | Bounded turn-level tool-dispatch loop. |
| `ToolLoopResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `VerifyResult` | interface | Outcome of verifying a candidate worktree. `feedback` (compiler errors, |
| `VetoedFact` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `WorktreeLoopRunnerOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEvalErrorCode` | type | Error taxonomy for `@tangle-network/agent-eval`. |
| `AgentRuntimeEvent` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentRuntimeEventSink` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentTaskStatus` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `AuthSource` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `ControlDecision` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `ConversationStreamEvent` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegatedLoopMode` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegatedLoopRegistry` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegatedLoopRunner` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `ForwardHeaderName` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `HaltPredicate` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `HaltReason` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `ImproveSurface` | type | The agent-profile lever `improve` optimizes. Mirrors the AgentProfile-law |
| `OpenAIChatResponseFormat` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `OpenAIChatToolChoice` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `PersonaDriver` | type | A persona that drives the conversation: either a full driver `AgentProfile` |
| `PropagatedHeaders` | type | Header bag carried through `AgentBackendContext.propagatedHeaders` so |
| `RetryableErrorPredicate` | type | Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors. |
| `RetryBackoff` | type | Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`. |
| `RuntimeDecisionKind` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeHookPhase` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeHookTarget` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `RuntimeStreamEvent` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `StreamToolLoopYield` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `ToolCallOutcome` | type | Outcome of one tool dispatch — structurally compatible with a hub/integration |
| `ToolLoopEvent` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `ToolLoopMessage` | type | A message in the running conversation the loop sends to `streamTurn`. |
| `ToolLoopStopReason` | type | Why the loop stopped. `completed` = model finished naturally; `stuck-loop` = |
| `TurnOrder` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `Verifier` | type | Verifies the edited worktree. Sync or async; throws only on a setup fault |

### Vertical agent — manifest + improvement adapter

Import from `@tangle-network/agent-runtime/agent` — 33 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `collectAgentRun` | function | Drain `act`'s `events` into an array AND await its `output`. Useful for |
| `createSandboxAct` | function | Build an `AgentRuntime.act` implementation backed by a single prod-profile |
| `createSurfaceImprovementAdapter` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createSurfaceKnowledgeAdapter` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `defineAgent` | function | Construct a validated agent manifest. Throws `AgentManifestError` |
| `measureOutcome` | function | Run `runAnalystLoop` and stamp an `OutcomeMeasurement` onto the |
| `renderSurfaceIssues` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `resolveSubjectPath` | function | Resolve a parsed `FindingSubject` to the file path the substrate |
| `unimplementedAgentRun` | function | Stub for agents whose `runtime.act` is not yet wired to the substrate's |
| `validateSurfaces` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentManifestError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentManifest` | interface | The full agent manifest. Each agent ships ONE of these. |
| `AgentRubric` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentRunContext` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentRunInvocation` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentRuntime` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentSurfaces` | interface | Surface declarations. Every path is repo-relative (or absolute) at |
| `AnalystConfig` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AutoApplyPolicy` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CreateSandboxActOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CreateSurfaceImprovementAdapterOpts` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CreateSurfaceKnowledgeAdapterOpts` | interface | Substrate-default `KnowledgeAdapter` — wraps agent-knowledge's |
| `DraftPatchInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DraftPatchOutput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `JudgeConfig` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `KnowledgeAdapterDeps` | interface | Build the adapter. We accept the agent-knowledge functions as DI so |
| `OutcomeMeasurement` | interface | `OutcomeMeasurement` — the missing metric that turns the analyst |
| `OutcomeMeasurementOpts` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ResolvedSurface` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RubricDimension` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SurfaceImprovementEdit` | interface | Substrate-default `ImprovementAdapter` — surfaces-driven, LLM-drafted |
| `SurfaceLifecycle` | interface | One profile surface's artifact-lifecycle wiring — the declarative config a |
| `SurfaceValidationIssue` | interface | Validate that every declared surface exists on disk under `repoRoot`. |

### Intelligence SDK — Observe + provable-OFF billing

Import from `@tangle-network/agent-runtime/intelligence` — 60 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `compileEffort` | function | Compile resolved `EffortSettings` into the orchestration overrides above. Pure: same |
| `composeCertifiedProfile` | function | Compose a certified profile into a uniform `ResolvedSurface`. Additive over |
| `composeCertifiedProfileFromWire` | function | Lower a plane `CertifiedProfile` straight into a `ResolvedSurface` via |
| `composeCertifiedPrompt` | function | Fold the certified prompt surface (and any certified prompt-folding artifacts: |
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
| `PullCertifiedOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
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

### Recursive atom + loop kernel (alias of ./runtime)

Import from `@tangle-network/agent-runtime/loops` — 401 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `acquireSandbox` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `analyzeTrace` | function | Collect the source's spans and run the agent-eval batch analyzers over them under one `runId`. |
| `anytimeReport` | function | Derive anytime metrics from waterfall spans. `targets` are the satisficing score |
| `asAuthoredProfile` | function | Narrow an untyped `spawn_agent` profile argument to an `AuthoredProfile`, or null if the |
| `assertModelAllowed` | function | Throw a `ConfigError` when `allowed` is set, `model` is defined, and `model` is not a |
| `assertStrategyContract` | function | Static CONTRACT lint over an authored strategy module — the module-boundary |
| `assessAuthoredProfile` | function | OBSERVE one authored `AgentProfile` and score its richness (no judge verdict is read). The task |
| `auditIntent` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `authoredWorker` | function | Build a worker AGENT from a profile the supervisor authored: the authored `systemPrompt` + |
| `authorStrategy` | function | Author + load a strategy from losses. Throws when the author emits no loadable module; |
| `breadthStrategy` | function | BREADTH: K independent rollouts (each own artifact), verifier picks the best. |
| `buildSteerContext` | function | Build the `SteerContext` a combinator reads to steer (its `loopUntil.until`, `widen` gate, any |
| `completionAuthorizes` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `computeFindingId` | function | Compute the stable finding_id from the identity-defining fields. |
| `contentAddress` | function | Mint the content-addressed `outRef` for a result artifact: `sha256:<hex>` over a |
| `createAgentEnvironmentProviderRegistry` | function | Create a registry that resolves provider names to concrete provider instances. |
| `createBudgetPool` | function | Create a conserved reservation pool from a root `Budget`. `now()` is injected so the |
| `createEventBus` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createExecutor` | function | The single built-in executor factory. Picks a leaf backend by data (`config.backend`), |
| `createExecutorRegistry` | function | The open resolver/registry. Pre-registers the three built-ins under their |
| `createInbox` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createInMemoryRunContext` | function | Build a fresh in-memory run context. Every call returns NEW stores (no shared global |
| `createMcpEnvironment` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createPushTraceSource` | function | A push source for OWNED tool loops (router-tools / cli-bridge tool dispatch): the loop calls |
| `createSandboxLineage` | function | Build a lineage bound to one client + its probed capabilities. The |
| `createScope` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createScopeAnalyst` | function | Build a `ScopeAnalyst` that spawns the analyst agent through `Scope.spawn` (so its compute is |
| `createShapeRegistry` | function | Build a fresh open `ShapeRegistry`. A factory is stored type-erased and re-cast on resolve — the |
| `createSupervisor` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createVerifierEnvironment` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createWaterfallCollector` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createWorktreeCliExecutor` | function | Build a worktree-CLI leaf `Executor`. Per-spawn (a fresh worktree + abort + teardown each), so a |
| `decodeToolPart` | function | Decode a part with a specific harness's adapter when known, else try every registered adapter |
| `defaultSelectWinner` | function | The kernel's winner argmax — best-valid-score, ties broken by earliest index, |
| `defaultToolDetectors` | function | The default online panel for a tool-call pipe: a worker repeating the same call, or hammering |
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
| `finalizeBestDelivered` | function | Keep-best finalize under the completion-oracle: return the highest-scoring DELIVERED child's |
| `flatWidenGate` | function | The flat default `ScopeWidenGate` — never widens, keeping the R2 selector≠judge collision |
| `gateOnDeliverable` | function | Wrap an `Executor` so its settlement `valid` reflects the deliverable check, not the |
| `gitWorkspace` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `harvestCorpus` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `inlineSandboxClient` | function | Adapt an `ExecutorFactory` into a `SandboxClient` for `runLoop`. The factory is |
| `inProcessSandboxClient` | function | Adapt a single `onPrompt(prompt, ctx)` callback into a `SandboxClient` for |
| `jjWorkspace` | function | A jj-backed `Workspace` (Jujutsu, colocated with git for the durable remote). |
| `leaderboard` | function | Aggregate a fleet of records into the ranked, multi-axis report. Pure — no IO, deterministic. |
| `localShell` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `loopCampaignDispatch` | function | Adapter for plain `runCampaign` scenarios. This is the runtime-side pair for |
| `loopDispatch` | function | Adapter for `runProfileMatrix` (profile is an axis). Returns a |
| `loopUntil` | function | `loopUntil(seed, spec)` — one `step` child per round; `fold` accumulates each settlement into |
| `makeFinding` | function | Convenience factory: produce a fully-formed AnalystFinding with the |
| `mapSandboxEvent` | function | Project one `SandboxEvent` onto the `RuntimeStreamEvent` chat-UX vocabulary, |
| `naiveDriver` | function | `naiveDriver` — the no-signal steering control. |
| `observe` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `openSandboxRun` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `panel` | function | `panel(spec)` — spawn the M judge children over the SAME artifact, drain their settlements, |
| `patchDelivered` | function | Build the `DeliverableSpec<WorktreePatchArtifact>`: `check(artifact)` runs the shared mechanical |
| `pickChampion` | function | The champion pick over a means table. 'score' takes the best mean score (ties → |
| `pipeline` | function | `pipeline(stages)` — run the stages in order, feeding each stage's `done` deliverable into the |
| `printBenchmarkReport` | function | Pretty-print a report — the "free optimization" verdict, with the cost vector. |
| `probeSandboxCapabilities` | function | Probe (and memoize per client) what the loop may rely on. A client without a |
| `profileRichnessFinding` | function | Turn a {@link ProfileRichness} verdict into a bus-routable `AnalystFinding` (area `profile-quality`). |
| `promotionGate` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `providerAsExecutor` | function | Adapt an environment provider into an `ExecutorFactory` for `createExecutor`. |
| `providerAsSandboxClient` | function | Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths. |
| `registerShape` | function | Register a composed shape on the default `builtinShapes` registry — the one-call extension |
| `registryScopeAnalyst` | function | A `ScopeAnalyst` backed by an `AnalystRegistry` — the panel-of-analysts seam. The registry merges |
| `renderAnytimeTable` | function | One row per (strategy, satisficing target): the shareable time-to-satisfactory table. |
| `renderCorpusToInstructions` | function | The learning-flywheel READ side. Queries the corpus through `filter`, renders the matching facts |
| `renderLeaderboardHtml` | function | Render a self-contained HTML leaderboard page (the hosted surface): the SVG charts + the full Markdown |
| `renderLeaderboardMarkdown` | function | Render the report as a publishable Markdown document: provenance → leaderboard → the full profile×axis |
| `renderLeaderboardSvg` | function | Render a self-contained SVG: a ranked score bar chart on top, the profile×axis heatmap below. No deps, |
| `renderReport` | function | Operator-facing report, split by who should act. The agent block is the |
| `reportLoopUsage` | function | Forward a `LoopResult`'s aggregated cost + token usage into a campaign cost |
| `resolveAgentEnvironmentProvider` | function | Resolve a provider instance or registry name, failing loudly when a name is unknown. |
| `routerBrain` | function | The router as a supervisor BRAIN: the canonical `ToolLoopChat` seam backed by the router's |
| `routerChatWithTools` | function | A router completion WITH tool-calling — the operator driver's LLM seam. Passes OpenAI-shape |
| `routerChatWithUsage` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `routerToolLoop` | function | The tool-using router backend: a real agentic loop OVER the Tangle router (which |
| `runAgentic` | function | Run a Strategy through the keystone Supervisor — `Agent.act` over a conserved-budget Scope. |
| `runBenchmark` | function | Run the requested strategies over the tasks, scored by the Environment's own check. |
| `runInWorkspace` | function | Run a worker `body` inside a FRESH clone of a shared `Workspace`, then commit its work back |
| `runLoop` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runPersonified` | function | Compose the persona + chosen shape onto a fresh keystone `Supervisor`. Resolves the shape |
| `runStrategyEvolution` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `sandboxClientAsProvider` | function | Adapt a `SandboxClient` into the shared `AgentEnvironmentProvider` contract. |
| `sandboxSessionTraceSource` | function | The SANDBOX / fleet trace source: read a box session's message parts and decode the harness's tool |
| `selectChampion` | function | Search-side champion selection over a tournament report. |
| `selectValidWinner` | function | The single content-free valid-only winner selector. Among the gated-VALID children only |
| `sentinelCompletion` | function | Completion for a sandbox-agent node: done iff the latest output carries the node's stop |
| `serveCoordinationMcp` | function | Stand up the coordination MCP over a live scope. The HOST address is `127.0.0.1` (the bridge runs |
| `settledToIteration` | function | The step-8 merge-boundary adapter (M4): rehydrate a `Settled.done` into the kernel's |
| `spendFromUsageEvents` | function | Fold a normalized `UsageEvent` array into a `Spend`. Tokens and usd are separate |
| `stopSentinel` | function | A unique, attributable stop sentinel for a node (ralph-loop style). Deterministic from the |
| `supervise` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `superviseSurface` | function | Drive a team of agents (spawned + steered by `profile`) to solve a graded `AgenticSurface` task, and |
| `supervisorAgent` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `supervisorInstructions` | function | The supervisor SKILL — the how-to the supervisor reads (its system prompt). THE optimizable |
| `trajectoryReport` | function | Reconstruct the whole spawn tree for `root` with per-node + rolled-up `Spend`. Reads the |
| `verify` | function | `verify(spec)` — an IMPLEMENT child produces a candidate, then a SEPARATE VERIFIER child grades |
| `watchTrace` | function | Subscribe to a `TraceSource` and run the streaming detectors over its live spans. Returns an |
| `widen` | function | `widen(spec)` — the streaming spawn-on-completion driver. Spawns the seed lineages, then REACTS |
| `workerFromBackend` | function | Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the |
| `worktreeFanout` | function | Build the worktree fanout combinator. Run it with `runPersonified({ persona, shape, task, budget })` |
| `adaptiveRefine` | const | A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot |
| `assertTraceDerivedFindings` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `builtinShapes` | const | The default registry `runPersonified` resolves a shape name against. Empty by construction — |
| `cliWorktreeExecutor` | const | The leaf `createWorktreeCliExecutor` as a backend-as-data factory: a supervisor-authored |
| `defaultAnalystInstruction` | const | The default observer instruction — exported so an optimizer can seed its population. |
| `defaultAuditorInstruction` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `defaultDelegateBudget` | const | The conserved pool a `delegate()` call applies when the caller does not pass its own `budget`. |
| `defaultProfileRichnessThresholds` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `refine` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `sample` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `sampleThenRefine` | const | The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open), |
| `strategyAuthorContract` | const | The compressed consumable a skill carries: everything an author needs to emit a loop. |
| `FileCorpus` | class | JSONL on disk — one validated `CorpusRecord` per line, append-only. `query` replays the whole |
| `InMemoryCorpus` | class | In-memory `Corpus`. Keyed by record `id`; `append` validates the record, is idempotent on an |
| `InMemoryResultBlobStore` | class | In-memory `ResultBlobStore`. Content-addressed: `put` verifies the supplied |
| `InMemorySpawnJournal` | class | In-memory `SpawnJournal`. Appends are observed-committed only; the impl enforces |
| `SandboxInstance` | class | A sandbox instance with methods for interaction. |
| `SandboxRunAbortError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `Agent` | interface | One self-similar atom. A leaf is an `Agent` that never calls `scope.spawn`; a driver |
| `AgentEnvironment` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEnvironmentCapabilities` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEnvironmentEvent` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEnvironmentProvider` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEnvironmentProviderRegistry` | interface | In-memory registry for named `AgentEnvironmentProvider` instances. |
| `AgentEnvironmentQuery` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEnvironmentSummary` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgenticOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgenticRunResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgenticSurface` | interface | A stateful, checkable environment an agent operates over with tools. Open behind one interface. |
| `AgenticTask` | interface | The general agentic primitive — sequential (depth) and parallel (breadth) over a shared, |
| `AgenticTool` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentProfile` | interface | Public provider-neutral agent profile contract. |
| `AgentRunSpec` | interface | Sandbox-SDK-shaped agent specification. |
| `AgentSession` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentSessionRef` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentSpec` | interface | `AgentProfile` does NOT carry a `harness`/backend field — `harness` lives on the |
| `AgentTurnInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentTurnResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AnalystFinding` | interface | Unified envelope every analyst emits. Schema-versioned so renderers |
| `AnalystRegistry` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AnytimeReport` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AnytimeStrategySummary` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AnytimeTaskCurve` | interface | anytimeReport — time-to-satisfactory-output metrics, derived entirely from the |
| `ArtifactHandle` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AuditIntentInput` | interface | auditIntent — the route-rigor analyst: is this trajectory even going the RIGHT WAY? |
| `AuditIntentOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AuthoredHarness` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AuthoredProfile` | interface | What the supervisor AUTHORS per sub-task — a worker recipe (a partial `AgentProfile`). |
| `AuthoredStrategy` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AuthorStrategyOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BenchmarkCell` | interface | One strategy's outcome on one task — the per-task cell an optimizer consumes. |
| `BenchmarkConfig` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BenchmarkLift` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BenchmarkReport` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BenchmarkStrategySummary` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BenchmarkTaskRow` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Budget` | interface | A budget envelope on a spawn or the root. All ceilings; the pool reserves against them. |
| `BudgetPool` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BusEvent` | interface | Every bus event is a discriminated union member keyed by `type`. |
| `BusRecord` | interface | A published event stamped for ordering and observability. `seq` is the monotonic publish index; |
| `BusStats` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ChampionPick` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CheckpointCapableBox` | interface | Loop-side widening of the box's optional checkpoint method. The |
| `CheckpointRef` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CheckpointRequest` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CompletionAnalyst` | interface | Reads a node's trace → a completion verdict. Same input shape as the `analyze` hook, so |
| `CompletionEvidence` | interface | Trace-derived evidence for a completion claim — an artifact (output) or a verifier metric, |
| `CompletionPolicy` | interface | When a verdict authorizes the driver to END. Deterministic → trust (ground truth); |
| `CompletionVerdict` | interface | The "is it done?" verdict an analyst returns to the parent. |
| `CoordinationMcpHandle` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Corpus` | interface | The durable cross-run corpus — the learning-flywheel store. DISTINCT from `SpawnJournal` |
| `CorpusFilter` | interface | A corpus query filter — every field is an AND-narrowing; an omitted field does not constrain. |
| `CorpusRecord` | interface | One accreted fact in the cross-run corpus — the learning-flywheel's durable unit. DISTINCT from |
| `CreateAgentEnvironmentInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CreateSandboxOptions` | interface | Configuration for creating a new sandbox. |
| `CreateScopeAnalystOptions` | interface | The analyst run an `Agent<unknown, AnalystFinding[]>` performs over the children settled so far. |
| `CriuCapableClient` | interface | Narrowed view of the optional CRIU probe. The loop-side `SandboxClient` |
| `DefaultVerdict` | interface | Minimal verdict shape — `valid` + `score` are required; `scores` + |
| `DefinePersonaInput` | interface | The minimal input to build a `Persona`. Mirrors `Persona` but lets the builder default |
| `DelegateOptions` | interface | Inputs to {@link delegate}. The intent is the first positional arg; everything here is optional |
| `DeliverableSpec` | interface | The deployable completion oracle passed to {@link gateOnDeliverable}: a `check` that |
| `Driver` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DriverAgentOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DumbDriverOptions` | interface | Options for {@link dumbDriver}. |
| `EqualKArm` | interface | One arm of an equal-k comparison — a labeled trajectory (a `TrajectoryReport` is one arm's whole |
| `EqualKOnCostOptions` | interface | `equalKOnCost(arms, { tolerance? })` — assert arms are comparable at EQUAL conserved COST |
| `EqualKVerdict` | interface | The equal-k-on-cost verdict: whether every arm spent within `tolerance` of the others on the |
| `EventBus` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EvolutionArchiveNode` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EvolutionAuthor` | interface | runStrategyEvolution — the multi-generation strategy search: per generation the system |
| `EvolutionBandInfo` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EvolutionCandidate` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EvolutionGeneration` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EvolutionReport` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ExecCtx` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ExecRequest` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ExecResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Executor` | interface | The leaf runtime — ONE open interface, not a closed union. `execute` returns a |
| `ExecutorContext` | interface | Construction context handed to a `ExecutorFactory` — the seams a built-in needs |
| `ExecutorRegistry` | interface | The OPEN resolver: maps an `AgentSpec` to a `ExecutorFactory`. The default |
| `ExecutorResult` | interface | Terminal artifact of a one-shot `Executor.execute`. |
| `FanoutOptions` | interface | `fanout(items, { synthesize? })` — N children spawned in one round (one per item, bounded by |
| `FanoutSynthesis` | interface | How a fanout's synthesis child is built + read. `synthesisTask` projects the drained child |
| `ForkCapableBox` | interface | Loop-side widening of the box's optional fork method. |
| `ForkRequest` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `GitWorkspaceOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `HarvestCorpusOptions` | interface | harvestCorpus — production traces → corpus, the G2 bridge (the playbook's step 6). |
| `HarvestFailure` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `HarvestReport` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Inbox` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `InboxMessage` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `InMemoryRunContext` | interface | The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`. |
| `InMemoryRunContextOptions` | interface | Options for the in-memory run context. |
| `InProcessPromptCtx` | interface | Context handed to each `onPrompt` call. |
| `InProcessSandboxClientOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `IntentAudit` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Iteration` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Leaderboard` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LeaderboardOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LeaderboardRow` | interface | One leaderboard row — a harness×model profile, every measured column. |
| `LoopCampaignDispatchOptions` | interface | Options for adapting plain agent-eval campaign scenarios into runtime `runLoop` cells. |
| `LoopDecisionPayload` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopDispatchOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopEndedPayload` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopIterationDispatchPayload` | interface | Where the iteration's worker was placed. `sibling` = a fresh sandbox the |
| `LoopIterationEndedPayload` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopIterationStartedPayload` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopLineageOptions` | interface | Opt-in box-lineage controls for `runLoop`. Default OFF — with both flags |
| `LoopPlanDescription` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopPlanPayload` | interface | Emitted once per `plan()` round, immediately after the driver plans. Carries |
| `LoopResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopSandboxPlacement` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopStartedPayload` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopTeardownFailedPayload` | interface | Emitted when a box's `delete()` throws or times out during teardown — the |
| `LoopTokenUsage` | interface | LLM token usage. Structurally matches agent-eval's `RunTokenUsage` / |
| `LoopTraceEmitter` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopUntilSpec` | interface | `loopUntil({ until, step })` — iterative deepening inside the conserved pool: spawn one `step` |
| `LoopUntilState` | interface | The accumulated state `loopUntil` threads across rounds — the running candidate + the round |
| `LoopWinner` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `McpEndpoint` | interface | Where a handle's MCP server lives; headers carry per-artifact scoping. |
| `McpEnvironmentOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `MountManifestEntry` | interface | One mounted resource recorded during box preparation — a pure provenance |
| `NaiveDriverOptions` | interface | Options for {@link naiveDriver}. |
| `Observation` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ObserveInput` | interface | The third-person observer — the connective tissue that closes the loop. |
| `ObserveOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `OpenSandboxRunOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `OutputAdapter` | interface | Stream of `SandboxEvent`s → typed `Output`. |
| `PanelJudge` | interface | One judge in a panel — a labeled persona-derived judge child. Content (the rubric) lives in |
| `PanelSpec` | interface | `panel(judges)` — M judges over ONE artifact, merged WRITE-ONLY (selector≠judge taken to its |
| `PanelVerdict` | interface | One judge child's settled verdict, surfaced to the write-only `merge`. `down` judges carry no |
| `PatchDeliverableOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Persona` | interface | The "act like X" record. A thin composition over the keystone's `AgentSpec`: it pairs the |
| `PersonaContext` | interface | The persona context blob — who the loop is acting as. Open by intent: a persona names its |
| `PersonaExecutors` | interface | How a persona supplies executor resolution. Either a pre-built registry (factories already |
| `PipelineStage` | interface | `pipeline(stages)` — sequential composition: each stage's `Outcome.deliverable` feeds the next |
| `PlacementInfo` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ProfileRichness` | interface | Per-field verdict on one authored profile — the raw material the bench renders + scores. |
| `ProfileRichnessThresholds` | interface | Thresholds below which a system prompt is treated as a thin stub. Tunable per call. |
| `PromotionGateOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `PromotionVerdict` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ProviderAsSandboxClientOptions` | interface | Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port. |
| `ProviderExecutorOptions` | interface | Options for running a provider as a supervise-mode executor. |
| `ProviderSeam` | interface | Generic environment provider executor config. External packages implement |
| `PublishOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RegistryAnalyzeProjection` | interface | Project a `ScopeAnalyzeInput` into the `AnalystRegistry.run` arguments. The registry runs over a |
| `RenderCorpusToInstructionsOptions` | interface | Project accreted corpus facts into an `AgentProfile`'s instruction seams — the learning-flywheel |
| `ReservationTicket` | interface | Opaque, single-use reservation handle returned by `reserve` and consumed by |
| `ResourceRequest` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ResultBlobStore` | interface | Content-addressed result blobs (the `outRef` → artifact map) backing the replay |
| `RouterChatResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RouterChatToolsResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RouterConfig` | interface | The one router chat client: direct OpenAI-compatible completions through the |
| `RouterToolCall` | interface | A tool-call the model emitted (provider-neutral; mirrors the runtime's ToolCallRequest). |
| `RouterToolLoopResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunAgenticOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunPersonifiedOptions` | interface | The end-to-end entrypoint. Builds the persona's root `Agent` from the chosen shape, then |
| `RunProvenance` | interface | Domain-free run provenance: a manifest of what was mounted into the run's |
| `SandboxCapabilities` | interface | What the loop kernel is allowed to know about a sandbox backend: a single |
| `SandboxClient` | interface | Minimal sandbox client surface the kernel calls. Satisfied structurally by |
| `SandboxClientProviderOptions` | interface | Options for wrapping the current Tangle sandbox client as an environment provider. |
| `SandboxEvent` | interface | SSE event from sandbox streaming. |
| `SandboxLineage` | interface | Owns box + session handles for one loop run and offers the three |
| `SandboxLineageHandle` | interface | A live box plus the session that threads its iterations together. Handed back |
| `SandboxRun` | interface | _(no summary — add a TSDoc line at the declaration)_ |
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
| `ShotSpec` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Spend` | interface | Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd |
| `SteerContext` | interface | How a combinator's `act` consumes findings to steer — the SINGLE firewalled steer surface a |
| `Strategy` | interface | A Strategy is HOW you spend the compute budget to beat the Environment's check — it |
| `StrategyCtx` | interface | What a strategy body composes with: the artifact lifecycle, the budget, and the two steps. |
| `StrategyEvolutionConfig` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `StrategyResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SuperviseOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SuperviseSurfaceOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SuperviseSurfaceResult` | interface | The deployable outcome of a supervised surface run. |
| `Supervisor` | interface | Owns the conserved pool, the spawn log, the abort cascade, the OTP intensity breaker, |
| `SupervisorAgentDeps` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SupervisorOpts` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SupervisorProfile` | interface | The supervisor's profile — the subset of an `AgentProfile` that selects + shapes its brain. |
| `SurfaceScore` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SurfaceWorkerConfig` | interface | How a worker runs the surface task (its router substrate + per-attempt bounds). |
| `SurfaceWorkerOut` | interface | What a surface worker settles with — the surface verdict the driver + deliverable read. `resolved` is |
| `ToolLoopCompaction` | interface | Self-compaction — bound the loop's OWN context window the way a fresh-respawn (dumb-Ralph) loop |
| `ToolSpec` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `TraceSource` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `TrajectoryAnalysis` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `TrajectoryNode` | interface | One node in the reconstructed trajectory tree — a driver OR a leaf, with its OWN spend and the |
| `TrajectoryReport` | interface | The whole reconstructed trajectory — the realized tree + its root-rolled-up total. The |
| `TrajectoryReportOptions` | interface | `trajectoryReport(journal, blobs, root, { withOutputs? })` — reconstruct the whole tree with |
| `TreeView` | interface | The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer. |
| `TurnResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `UsageSink` | interface | The slice of an agent-eval campaign `DispatchContext.cost` this needs. |
| `ValidationCtx` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Validator` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `VerifierEnvironmentOptions` | interface | createVerifierEnvironment — ANY checkable task as an `Environment`, no tool surface |
| `VerifySpec` | interface | `verify({ implement, verifier })` — the 2-node sequential gate: an IMPLEMENT child produces a |
| `WatchTraceOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `WaterfallCollector` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `WaterfallReport` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `WaterfallSpan` | interface | createWaterfallCollector — 100% trajectory observability from the lifecycle stream: |
| `WidenGate` | interface | The progressive-widening gate (MCTS-PW). Decides whether a settled child is |
| `WidenLineage` | interface | A lineage the gate may widen toward — the settled child that looked promising + the findings |
| `WidenSpec` | interface | `widen({ gate })` (G5) — the STREAMING spawn-on-completion driver. Unlike the static-fanout |
| `Workspace` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `WorkspaceRequest` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `WorkspaceRun` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `WorktreeCliExecutorOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `WorktreeCommandResult` | interface | Outcome of one verification command run in the worktree (test or typecheck). |
| `WorktreeFanoutOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEnvironmentProviderRef` | type | Provider object or registry name accepted by runtime provider adapters. |
| `AgentEnvironmentStatus` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentProfileRef` | type | Portable profile reference: inline profile or provider catalog id. |
| `AgentSessionStatus` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `ApplyContinuation` | type | Fold a steering string into the caller's Task shape, producing the Task for |
| `AssertTraceDerivedFindings` | type | The firewall assertion contract, re-stated for the reactive seam (PORT of |
| `BudgetReadout` | type | Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`, |
| `ChampionPolicy` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `CombinatorShape` | type | A combinator is just a `LoopShape`: a factory `(ShapeContext) => Agent` whose `Agent.act` |
| `CoordinationEvent` | type | Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for |
| `DefinePersona` | type | Builds a frozen `Persona`, failing loud on the executors-supplied invariant (neither a |
| `Deliverable` | type | _(no summary — add a TSDoc line at the declaration)_ |
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
| `LoopTraceEvent` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopUntil` | type | `loopUntil(spec)` — build the iterative-deepening combinator. `seed` is the initial state. |
| `MakeWorkerAgent` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `MountRecorder` | type | Records a mounted resource into the run's provenance manifest. Passed to |
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
| `WorkspaceCommit` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `WorktreePatchArtifact` | type | Terminal artifact of one worktree-CLI run — the canonical worktree-harness result (the captured |

### Environment provider adapters — generic sandbox/compute bridge

Import from `@tangle-network/agent-runtime/environment-provider` — 32 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `createAgentEnvironmentProviderRegistry` | function | Create a registry that resolves provider names to concrete provider instances. |
| `providerAsExecutor` | function | Adapt an environment provider into an `ExecutorFactory` for `createExecutor`. |
| `providerAsSandboxClient` | function | Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths. |
| `resolveAgentEnvironmentProvider` | function | Resolve a provider instance or registry name, failing loudly when a name is unknown. |
| `sandboxClientAsProvider` | function | Adapt a `SandboxClient` into the shared `AgentEnvironmentProvider` contract. |
| `AgentEnvironment` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEnvironmentCapabilities` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEnvironmentEvent` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEnvironmentProvider` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEnvironmentProviderRegistry` | interface | In-memory registry for named `AgentEnvironmentProvider` instances. |
| `AgentEnvironmentQuery` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEnvironmentSummary` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentSession` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentSessionRef` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentTurnInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentTurnResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CheckpointRef` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CheckpointRequest` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CreateAgentEnvironmentInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ExecRequest` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ExecResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ForkRequest` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `PlacementInfo` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ProviderAsSandboxClientOptions` | interface | Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port. |
| `ProviderExecutorOptions` | interface | Options for running a provider as a supervise-mode executor. |
| `ResourceRequest` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SandboxClientProviderOptions` | interface | Options for wrapping the current Tangle sandbox client as an environment provider. |
| `WorkspaceRequest` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentEnvironmentProviderRef` | type | Provider object or registry name accepted by runtime provider adapters. |
| `AgentEnvironmentStatus` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `AgentProfileRef` | type | Portable profile reference: inline profile or provider catalog id. |
| `AgentSessionStatus` | type | _(no summary — add a TSDoc line at the declaration)_ |

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
| `ImprovementEditBatch` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ImprovementReport` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `KnowledgeAdapter` | interface | Knowledge-side bridge — consumers wire `proposeFromFindings` from agent-knowledge. |
| `KnowledgeProposalBatch` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `KnowledgeReport` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunAnalystLoopOpts` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunAnalystLoopResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AnalystLoopEvent` | type | Events emitted by `runAnalystLoop` via `opts.onEvent`. UIs and |

### Artifact lifecycle — generate → measure → promote → compose

Import from `@tangle-network/agent-runtime/lifecycle` — 59 exports.

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
| `thresholdPromotionGate` | function | The simplest honest gate: promote iff the candidate's marginal lift on the |
| `worktreeBuildCandidate` | function | Build the production per-candidate seam for `buildableGenerator`. Each call to |
| `lifecycleReasonKey` | const | The metadata key under which the registry records WHY an artifact left the |
| `liftMetadataKey` | const | The metadata key under which the registry stores an artifact's measured held- |
| `ArtifactRegistry` | class | A typed, in-memory registry of `ProfileArtifact`s with stable ids. |
| `ArtifactPayloads` | interface | The payload for each `ArtifactKind`. The shapes are the SAME types the |
| `ArtifactQuery` | interface | Filter for `list`. Omit a field to leave that dimension unconstrained. |
| `BuildableGeneratorOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BuiltCandidate` | interface | The result of building ONE candidate in its own worktree. A build either |
| `CandidateGenerator` | interface | Produces fresh, UNMEASURED candidate artifacts for ONE profile surface. |
| `CandidateOutcome` | interface | The per-candidate record of what the loop decided and why. |
| `ComposeProfileOptions` | interface | `composeProfile` — fold the top-k active artifacts back into a profile. |
| `DedupeOptions` | interface | `dedupeArtifacts` — retire the redundant half of a non-stacking pair. |
| `DedupeResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DriftCheck` | interface | Per-artifact record of what the re-measure found and decided. |
| `DriftWatchOptions` | interface | `driftWatch` — the scheduled re-measure that DEMOTES decayed artifacts. |
| `DriftWatchResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EvalResult` | interface | The result of running an eval over ONE profile: a composite score and the cost |
| `GenerateContext` | interface | The read-only context a generator sees when proposing candidates. It is the |
| `HeldOutPromotionGateOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `MarginalLift` | interface | The marginal lift of one artifact: the with/without ablation. |
| `MeasureMarginalLiftOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `PairStackCheck` | interface | The stacking verdict for one pair of active artifacts. |
| `ProductionPromptGeneratorOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ProfileArtifact` | interface | A discrete, individually-promotable piece of an agent profile. |
| `PromotionGate` | interface | Decides whether ONE measured candidate is promoted. The lifecycle calls this |
| `PromotionVerdict` | interface | The verdict a gate returns for one candidate. |
| `PromptDraft` | interface | A proposed prompt instruction line plus the WHY behind it. The `rationale` |
| `PromptGeneratorOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunLifecycleOptions` | interface | `runLifecycle` — the ONE closed-loop orchestrator: generate → measure → |
| `RunLifecycleResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SkillDraft` | interface | A distilled skill draft: a name + the `SKILL.md` body. |
| `SkillGeneratorOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
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

### Built-in agent profiles

Import from `@tangle-network/agent-runtime/profiles` — 43 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `appendFindings` | function | Append findings to a workspace, writing one Markdown file per finding |
| `buildAuditorSystemPrompt` | function | Build a system prompt for a single auditor iteration. |
| `coderTaskToPrompt` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createInProcessUiAuditClient` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createUiAuditorValidator` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `decodeAuditTaskEnvelope` | function | Parse a task envelope back out of a prompt string. Returns undefined if |
| `encodeAuditTaskEnvelope` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `formatAuditorPrompt` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `initAuditWorkspace` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `parseAuditorEvents` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `readAuditRegistry` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `registerCaptures` | function | Record screenshots taken for a route in the registry, without filing a |
| `summarizeRegistry` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `uiAuditorProfile` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `writeAuditIndex` | function | Regenerate `<workspace>/index.md` from registry.json. |
| `LENS_BRIEFS` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `SHARED_AUDITOR_RULES` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `UI_FINDING_SEVERITIES` | const | Frozen severity tuple, ordered worst → least bad for sort/report. |
| `UI_LENSES` | const | Frozen tuple of lenses for validation + iteration. |
| `AppendFindingsResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AuditIndex` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AuditRegistry` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AuditRegistryCapture` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BrowserContextHandle` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BrowserHandle` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CoderTask` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `InProcessUiAuditClientOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `PageHandle` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RegisterCapturesOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `UiAuditCapture` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `UiAuditCaptureRequest` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `UiAuditorProfileOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `UiAuditOutput` | interface | Output of one iteration. `findings` is the headline payload; `captures` |
| `UiAuditTask` | interface | One iteration's task: audit a single (lens × route) pair, capturing the |
| `UiAuditViewport` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `UiFinding` | interface | A single UI audit finding — the unit of work a contributor can act on. |
| `UiFindingScreenshot` | interface | Pointer to a screenshot referenced by a finding (workspace-relative path). |
| `UiJudgeInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `UiJudgeOutput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `UiJudgeTokenUsage` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `UiFindingSeverity` | type | Severity scale. |
| `UiJudge` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `UiLens` | type | Canonical audit lenses. Each lens scopes a finding to a single class of |

### Platform glue

Import from `@tangle-network/agent-runtime/platform` — 20 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `PlatformAuthClient` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `PlatformAuthError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `PlatformHubClient` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `PlatformHubError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `AuthorizeUrlOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CatalogResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ConnectionHealth` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ConnectionHealthResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ExchangeCodeResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ExecInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `HealthCheck` | interface | Last-known health for a connection, derived from the connection row. |
| `MintTokenInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `MintTokenResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `PlatformAuthClientOptions` | interface | Server-side client for the Tangle platform's cross-site SSO bridge. |
| `PlatformCatalogProvider` | interface | A connectable provider in the catalog (`/v1/hub/providers`). |
| `PlatformConnection` | interface | A live integration connection, as returned by `/v1/hub/connections`. |
| `PlatformHubClientOptions` | interface | Server-side client for the Tangle platform's integration hub |
| `PlatformHubStatus` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `StartAuthInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `StartAuthResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |

### MCP servers — delegate / coordination / detached-session

Import from `@tangle-network/agent-runtime/mcp` — 170 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `buildDelegationTraceSpans` | function | Derive the compact span tree for ONE loop run from its buffered |
| `capDelegationTrace` | function | Enforce the trace caps over an ordered (oldest-first) span list. Drops the |
| `captureWorktreeDiff` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `coderTaskFromArgs` | function | Canonical `DelegateCodeArgs` → `CoderTask` mapping — the single source for |
| `composeLoopTraceEmitters` | function | Fan one `LoopTraceEvent` stream into several emitters — e.g. the |
| `createCoordinationTools` | function | Build the driver's MCP tools over a live scope. |
| `createDelegateFeedbackHandler` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createDelegateHandler` | function | Build the `delegate` tool handler. Closes over the injected supervisor substrate (`router` / |
| `createDelegateUiAuditHandler` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createDelegationHistoryHandler` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createDelegationStatusHandler` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createDelegationTraceCollector` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createDetachedTurnResumeDriver` | function | Build the `driveTurn`-backed {@link DelegationResumeDriver}. Each `tick()` |
| `createFleetWorkspaceExecutor` | function | Build an executor that resolves each delegated iteration to an existing |
| `createInProcessExecutor` | function | Build an in-process executor. Returns a {@link DelegationExecutor} whose `client.create()` |
| `createInProcessTransport` | function | In-process pair of `Readable` + `Writable` streams suitable for driving |
| `createKbGate` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createMcpServer` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `createPropagatingTraceEmitter` | function | Create a LoopTraceEmitter that: |
| `createSiblingSandboxExecutor` | function | Wrap a raw sandbox SDK client so the kernel emits |
| `createWorktree` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `detachedSessionDelegate` | function | Build the sandbox-session coder delegate. It drives `runLoop` against the project's |
| `detachedTurnEvents` | function | Synthesize the terminal event array a detached turn settles through. Shaped |
| `detectExecutor` | function | Pick the right executor for an MCP server invocation based on env vars. |
| `eventToSnapshot` | function | Project a `FeedbackEvent` down to the snapshot shape carried on |
| `formatDetachedSessionRef` | function | Encode ref parts into the JSON-safe string stored on the record: |
| `hashIdempotencyInput` | function | Best-effort stable hash for use as `idempotencyKey`. Not cryptographic; |
| `liftFindings` | function | Lift validated raw rows into `AnalystFinding`s (agent-eval `makeFinding` stamps `finding_id`/ |
| `makeCheckRunner` | function | Build a `run_analyst` runner over a kind directory. |
| `mcpToolsForRuntimeMcp` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `mcpToolsForRuntimeMcpSubset` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `parseDetachedSessionRef` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `readTraceContextFromEnv` | function | Read trace context from the process environment. |
| `removeWorktree` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `renderTrace` | function | Render a worker's trace (tool calls + results) into the text an analyst lens reads. Generic over |
| `runCheck` | function | Run ONE lens over a trace → findings. Generic over any kind: prompt = the lens + the agent-eval |
| `runDetachedTurn` | function | Dispatch one detached turn and advance it to a terminal state with |
| `runLocalHarness` | function | Spawn a local coding harness CLI as a subprocess + collect its output. |
| `settleDetachedCoderTurn` | function | Settle a completed detached coder turn through the same gate the streaming |
| `traceContextToEnv` | function | Build env vars to pass to a child MCP subprocess so it inherits the |
| `validateDelegateArgs` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `validateDelegateFeedbackArgs` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `validateDelegateUiAuditArgs` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `validateDelegationHistoryArgs` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `validateDelegationStatusArgs` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `defaultChecks` | const | The built-in lens directory. Domain-blind (about any agent trace); compose at test time. |
| `DELEGATE_DESCRIPTION` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATE_FEEDBACK_DESCRIPTION` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATE_FEEDBACK_INPUT_SCHEMA` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATE_FEEDBACK_TOOL_NAME` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATE_INPUT_SCHEMA` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATE_TOOL_NAME` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATE_UI_AUDIT_DESCRIPTION` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATE_UI_AUDIT_INPUT_SCHEMA` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATE_UI_AUDIT_TOOL_NAME` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATION_HISTORY_DESCRIPTION` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATION_HISTORY_INPUT_SCHEMA` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATION_HISTORY_TOOL_NAME` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATION_STATUS_DESCRIPTION` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATION_STATUS_INPUT_SCHEMA` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATION_STATUS_TOOL_NAME` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DELEGATION_TRACE_MAX_BYTES` | const | Default cap on the serialized trace payload per record, in bytes. |
| `DELEGATION_TRACE_MAX_SPANS` | const | Default cap on spans retained per delegation record. |
| `DelegationPersistenceError` | class | A delegation-store read or write failed (filesystem error, store |
| `DelegationStateCorruptError` | class | The persisted delegation state exists but cannot be parsed into |
| `DelegationTaskQueue` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `FileDelegationStore` | class | JSON-file persistence for the delegation queue. Each write serializes |
| `InMemoryDelegationStore` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `InMemoryFeedbackStore` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `AnalystRegistry` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CappedDelegationTrace` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Check` | interface | One lens — a composable analyst kind. Identity fields mirror `TraceAnalystKindSpec` so a kind is |
| `CheckRunnerOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CoderReview` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CoordinationTools` | interface | The supervisor-side toolbox returned by {@link createCoordinationTools}: the MCP tool |
| `CoordinationToolsOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CreateKbGateOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CreateWorktreeOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateArgs` | interface | Parsed `delegate` tool arguments. |
| `DelegateCodeArgs` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateCodeConfig` | interface | Minimal `CoderTask` overrides exposed over the MCP wire. The full |
| `DelegateCodeResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateFeedbackArgs` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateFeedbackResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateHandlerOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateResearchArgs` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateResearchConfig` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateResearchResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateRunCtx` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateUiAuditArgs` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateUiAuditConfig` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateUiAuditResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegateUiAuditRoute` | interface | Optional per-route capture spec the agent surfaces over the wire. |
| `DelegationError` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationExecutor` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationFeedbackSnapshot` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationHistoryArgs` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationHistoryEntry` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationHistoryResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationProgress` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationRecord` | interface | Must be JSON-safe end to end (`args`, `result`, `error`, `feedback`) — |
| `DelegationResumeContext` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationResumeDriver` | interface | Re-attaches restored in-flight records to their detached runs. The queue |
| `DelegationRunContext` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationStatusArgs` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationStatusResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationStore` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationTaskQueueOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationTraceCaps` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationTraceCollector` | interface | Per-delegation trace collector. Buffers `LoopTraceEvent`s per runId |
| `DelegationTraceSpan` | interface | One span of a delegation's compact trace. Flat (parent linkage by id), all |
| `DetachedSessionDelegateOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DetachedSessionRefParts` | interface | Decoded `DelegationRecord.detachedSessionRef`. `sandboxId` is absent between |
| `DetachedTurn` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DetachedTurnResumeDriverOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DetectExecutorArgs` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DiffOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DiffResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DriveTurnCapableBox` | interface | The box surface detached turns need. `SandboxInstance` |
| `FactCandidate` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FactJudge` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FactJudgeVerdict` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FeedbackEvent` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FeedbackRating` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FeedbackRefersTo` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FeedbackStore` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FileDelegationStoreOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FleetHandle` | interface | Minimal `SandboxFleet` surface the fleet executor calls. Declared |
| `FleetWorkspaceExecutorOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `InProcessExecutorDescribePlacement` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `InProcessExecutorOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `JsonRpcMessage` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `JsonRpcResponse` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `KbGateResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LocalHarnessResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `McpServer` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `McpServerOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `McpToolDescriptor` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `McpTransport` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Question` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `QuestionRecord` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RemoveWorktreeOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ResearchOutputShape` | interface | Loose shape of a research output over the wire — the substrate cannot |
| `RunDetachedTurnOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunLocalHarnessOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SettleDetachedCoderTurnOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SettledWorker` | interface | A worker the driver has drained via `await_event`. |
| `SiblingSandboxExecutorOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SubmitInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SubmitOutput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `TraceContext` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `UiAuditorDelegationOutput` | interface | Wire-shape of a completed UI-audit delegation. The `findings` array |
| `WorktreeHandle` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CoderDelegate` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `CoderReviewer` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `CoordinationEvent` | type | Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for |
| `DelegateResult` | type | The synchronous result the `delegate` tool returns to the calling agent: the delivered output (or |
| `DelegationProfile` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `DelegationResultPayload` | type | Polymorphic `result` field: `CoderOutput` when the underlying profile |
| `DelegationResumeTick` | type | One observation of a detached run, mapped 1:1 from a single-tick driver |
| `DelegationStatus` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `DetachedWinnerSelection` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `DriveTurnTick` | type | Structural mirror of the sandbox SDK's `TurnDriveResult` (>= 0.6). |
| `GitRunner` | type | Pluggable git runner (sync) — replaceable in tests. |
| `LocalHarness` | type | Local coding harness available inside the sandbox. |
| `MakeWorkerAgent` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `QuestionDecision` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `QuestionPolicy` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `ResearchSource` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `UiAuditorDelegate` | type | UI-auditor delegate — fully consumer-injected. agent-runtime ships no |

## 2. agent-eval — substrate primitives to REUSE

The scoring/measurement/judge substrate. **Do NOT re-implement a judge, an authenticity check, a verifier, a statistics routine, a profile-matrix runner, or usage extraction** — import them from here. The category→subpath mapping is curated; the symbols are generated.

### JUDGE — LLM-as-judge, panels, calibration

Import from `@tangle-network/agent-eval` — 30 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `buildAgreementJudge` | function | Build a `JudgeConfig` that scores a produced student artifact against the |
| `cachedJudge` | function | Wrap a `JudgeConfig` so repeat judgments of the same artifact are served |
| `calibrateJudge` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `compilerJudge` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `contractJudge` | function | Adapt trace contracts to a campaign `JudgeConfig`. One judge dimension per |
| `createAntiSlopJudge` | function | Create a reusable Judge function from an anti-slop config. |
| `createCustomJudge` | function | Create a custom judge with a fully custom prompt. |
| `createDomainExpertJudge` | function | Create a domain expert judge with a configurable domain. |
| `createIntentMatchJudge` | function | Factory: pin LLM options once, return a closure. |
| `createSemanticConceptJudge` | function | Factory: pin LLM options once, return a closure that accepts inputs. |
| `ensembleJudge` | function | Build a campaign-shaped `JudgeConfig` whose `score()` runs every panel |
| `judgeFamily` | function | Classify a model id into its provider family. Strips a `@snapshot` suffix |
| `judgeReplayGate` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `judgeSpans` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `linterJudge` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `llmJudge` | function | Build a campaign-shaped `JudgeConfig` whose `score()` makes ONE LLM call |
| `replayTraceThroughJudge` | function | Apply a judge function to every LLM span in a run and record the |
| `runIntentMatchJudge` | function | Run the intent-match judge. Soft-fails to available=false on error. |
| `runKeywordCoverageJudge` | function | Score expected concepts against an already-fetched HTML payload + any |
| `runSemanticConceptJudge` | function | Run the semantic concept judge. Soft-fails to available=false on |
| `securityJudge` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `testJudge` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `traceJudge` | function | Wrap a single JudgeFn so its LLM call emits a traced span. |
| `adversarialJudge` | const | Adversarial judge — red-teams agent responses. |
| `codeExecutionJudge` | const | Code execution judge — evaluates whether code blocks are valid and runnable. |
| `coherenceJudge` | const | Coherence judge — evaluates multi-turn consistency and progression. |
| `CalibrationResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ContinuousCalibrationResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `JudgeConfig` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CachedJudge` | type | The wrapped judge: same `JudgeConfig` seam, plus hit/miss observability. |

### AUTHENTICITY — is-this-real / anti-Goodhart gate

Import from `@tangle-network/agent-eval/authenticity` — 14 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `gateRealness` | function | Anti-Goodhart gate: a required-artifact-missing or faked submission is |
| `judgeRealnessLlm` | function | Ask an LLM to rate realness DIRECTLY on a 0-100 scale — the axis that matched |
| `scoreAuthenticity` | function | Deterministic authenticity scan of produced files. Pure — same files in, |
| `scoreAuthenticityNuance` | function | LLM nuance scoring — judges the "looks real but is hollow" axis structure |
| `scoreRealnessBlended` | function | Score realness using the cheapest sufficient signal: trust the deterministic |
| `AuthenticityNuance` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AuthenticityResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AuthenticitySignals` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BlendedRealness` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ProducedFile` | interface | Authenticity — "is this real, or convincing BS?" |
| `RealnessGate` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RealnessJudgment` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CompleteFn` | type | A minimal completion fn — inject your model caller (router/tcloud). Keeps |
| `RealnessBand` | type | _(no summary — add a TSDoc line at the declaration)_ |

### VERIFICATION — multi-layer verifier + semantic grading

Import from `@tangle-network/agent-eval` — 10 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `gradeSemanticStatus` | function | Grade a semantic-concept-style judge result into a single layer status. |
| `verifyAgentProfileCell` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `verifyAttestation` | function | Verify a report against its attestation. Returns a typed outcome rather |
| `verifyCompletion` | function | Verify whether a run completed the task. `checkCorrectness` is injected — |
| `verifyManifest` | function | Verify that a signed manifest has not been tampered with. |
| `MultiLayerVerifier` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `Finding` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `VerificationReport` | interface | Extends the substrate verdict spine: `valid` = `allPass` and `score` = |
| `VerifyOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LayerStatus` | type | Multi-layer verifier — ordered pipeline of verification layers. |

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
| `BootstrapOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BootstrapResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CorpusAgreementOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CorpusAgreementPerDimension` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CorpusAgreementReport` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CorpusScoreRecord` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EProcess` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EProcessOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EProcessState` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EProcessStep` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `McNemarResult` | interface | Result of a McNemar paired-binary significance test. |
| `PairedBootstrapOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `PairedBootstrapResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ProportionInterval` | interface | A binomial proportion estimate with a confidence interval. |
| `RiskDifferenceResult` | interface | A paired binary effect size (treatment rate − control rate) with a CI. |
| `WeightedCompositeInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `WeightedCompositeResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CliffsMagnitude` | type | _(no summary — add a TSDoc line at the declaration)_ |

### CAMPAIGN — profile matrix, gates, improvement loop

Import from `@tangle-network/agent-eval/campaign` — 206 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `aceProposer` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `applySkillPatch` | function | Apply a SkillOpt patch to a text surface. Ops apply in array order against |
| `buildAnalystSurfaceDispatch` | function | Build the `dispatchWithSurface(surface, scenario, ctx)` the improvement loop |
| `buildEvidenceVector` | function | The Evidence Bus. For each objective, pair candidate vs baseline by full |
| `buildLoopProvenanceRecord` | function | Build the durable provenance record from a completed loop result. |
| `campaignBreakdown` | function | Per-candidate evidence a reflective/patch proposer grounds its next proposal |
| `campaignMeanComposite` | function | Mean composite across a campaign: per cell, the mean of its judges' |
| `compareProposers` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `composeGate` | function | Compose gates — all must `ship` for the composite to `ship`. First |
| `countSentenceEdits` | function | Sentence-level edit distance — count distinct add/remove ops between |
| `defaultProductionGate` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `defaultRenderDiff` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `detectScale` | function | Detect the native scale of a set of scores: 0-100 when any magnitude clears |
| `dimensionRegressions` | function | Per-critical-dimension regression guard. For each dimension, pair the |
| `emitLoopProvenance` | function | Build the provenance record + OTel spans and persist them durably under the |
| `evolutionaryProposer` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `extractFapoAttributionSignals` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `extractH2Sections` | function | Extract H2 headings (`## Foo`) from a markdown surface. Exported for |
| `failureModeRecallJudge` | function | Deterministic, ground-truth judge for analyst findings. Composite = |
| `fapoEscalationEntry` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `fapoProposer` | function | Build a FAPO policy proposer from level-specific candidate generators. |
| `fsCampaignStorage` | function | Node-filesystem storage — the default. Lazily requires `node:fs` so the |
| `gepaParetoEntry` | function | GEPA with the Pareto frontier + combine-complementary-lessons. |
| `gepaProposer` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `gepaReflectionEntry` | function | GEPA, reflection-only (single-parent, no Pareto combine). |
| `gitWorktreeAdapter` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `haloProposer` | function | Wrap the real halo-engine CLI as a SurfaceProposer (prompt-tier). |
| `heldOutGate` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `heldoutSignificance` | function | Significance of the held-out composite lift: ship only when the paired |
| `inMemoryCampaignStorage` | function | In-memory storage for filesystem-less runtimes. Artifacts + trace spans |
| `isProposedCandidate` | function | Type guard: a proposal carrying its rationale vs a bare |
| `labelTrustRank` | function | Ordinal rank for a label-trust tier; absent ⇒ `unverified` (rank 0). |
| `llmJudge` | function | Build a campaign-shaped `JudgeConfig` whose `score()` makes ONE LLM call |
| `loopProvenanceSpans` | function | Build the loop's OTLP-ingestable spans from a provenance record. One root |
| `makePlaybackDispatch` | function | Adapt a `PlaybackDriver` into a `runProfileMatrix` dispatch. The artifact the |
| `memoryCurationProposer` | function | Build the CURATOR proposer. |
| `openAutoPr` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `pairHoldout` | function | Pair candidate vs baseline holdout observations by FULL cellId. `select` |
| `parameterSweepProposer` | function | Config/parameter-level proposer for FAPO's middle escalation level. |
| `paretoSignificanceGate` | function | Wrap the bus + a policy as a `Gate`. Plugs into the existing |
| `parseSkillPatchResponse` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `patchEditCount` | function | Total ops in a patch — the edit-budget axis (SkillOpt's "textual learning |
| `provenanceRecordPath` | function | Canonical durable paths under the run dir. |
| `provenanceSpansPath` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `renderScoreboardMarkdown` | function | Render the scoreboard as a launch-readiness Markdown document — the literal |
| `resolveWorktreePath` | function | Resolve a `CodeSurface`'s worktreeRef to a directory the measurement can |
| `runCampaign` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runEval` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runImprovementLoop` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runOptimization` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runProfileMatrix` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `runSkillOpt` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `scoreboardSummary` | function | Roll the per-requirement rows up into the launch headline counts. |
| `scoreUserStory` | function | Score one story's produced state against its requirements. Thin wrapper over |
| `sequentialDecide` | function | `SurfaceProposer.decide` adapter — stops the optimization loop the moment |
| `sequentialPairedGate` | function | Anytime-valid sequential paired gate. Conforms to the existing `Gate` |
| `skillOptEntry` | function | SkillOpt patch-mode hill-climb. Runs findings-BLIND: `runSkillOpt` owns its |
| `skillOptProposer` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `surfaceContentHash` | function | Stable sha256 (full hex) of a surface's effective text. Code surfaces hash |
| `surfaceHash` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `traceAnalystProposer` | function | Wrap agent-eval's trace-analyst registry as a SurfaceProposer (prompt-tier). |
| `userStoryScoreboard` | function | Flatten story verdicts into the per-requirement scoreboard — the literal |
| `paretoPolicy` | const | The default strategy: symmetric multi-objective Pareto significance. Ship iff |
| `FsLabeledScenarioStore` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `LabeledScenarioStoreError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `ProfileMatrixError` | class | Thrown when the matrix is misconfigured (no profiles, a profile whose model |
| `SkillPatchParseError` | class | Parse + validate the patch response. Throws `SkillPatchParseError` when the |
| `WorktreeAdapterError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `AcceptedEdit` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AceProposerOptions` | interface | `aceProposer` — Agentic Context Engineering: an APPEND-MOSTLY curator, the |
| `AnalystArtifact` | interface | The analyst's output for one scenario — the artifact the judge scores. |
| `AnalystScenario` | interface | A labeled trace scenario: a FIXED trace corpus plus the failure modes a |
| `ApplySkillPatchResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AxisEvidence` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BuildAnalystSurfaceDispatchOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BuildEvidenceVectorOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `BuildLoopProvenanceArgs` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CampaignAggregates` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CampaignArtifactWriter` | interface | Scoped artifact writer — `write(path, content)` lands under |
| `CampaignBreakdown` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CampaignCellResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CampaignCostMeter` | interface | Cell-scoped cost meter. NOTHING is captured automatically — |
| `CampaignResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `CampaignStorage` | interface | `CampaignStorage` — the filesystem seam `runCampaign` writes through |
| `CampaignTraceWriter` | interface | Scoped trace writer handed to each dispatch — every span |
| `CodeSurface` | interface | A tier-4 code surface — a candidate change to the agent's |
| `CompareProposersOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DefaultProductionGateOptions` | interface | `defaultProductionGate` — composes the substrate's existing safety |
| `DimensionRegression` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `DispatchContext` | interface | Context handed to every dispatch invocation. Scoped — every |
| `EmitLoopProvenanceArgs` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EmitLoopProvenanceResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EvidenceVector` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `EvolutionaryProposerOptions` | interface | `evolutionaryProposer` — adapts a stateless `Mutator` (population mutation: |
| `FailureModeRecallJudgeOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FapoAttributionSignals` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FapoEntryConfig` | interface | FAPO reviewed-escalation policy. This is an orchestration layer over |
| `FapoFailureCluster` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FapoProposerOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FapoReviewInput` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FapoReviewIssue` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FapoReviewResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FapoScopeContract` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `FsLabeledScenarioStoreOptions` | interface | Filesystem `LabeledScenarioStore` adapter. The default capture sink for |
| `Gate` | interface | Composable promotion gate. |
| `GateContext` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `GateResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `GenerationCandidate` | interface | One scored candidate surface in a generation. `dimensions` + `scenarios` |
| `GenerationRecord` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `GepaProposerConstraints` | interface | `gepaProposer` — a reflective `SurfaceProposer` for prompt-tier surfaces. |
| `GepaProposerOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `GitWorktreeAdapterOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `HaloProposerOptions` | interface | `haloProposer` — wraps the REAL halo-engine (Inference.net's hierarchical |
| `HeldOutGateOptions` | interface | Thin Gate adapter — exposes delta-threshold-on-holdout as a composable |
| `HeldoutSignificance` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `HeldoutSignificanceOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `JudgeAggregate` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `JudgeConfig` | interface | Pluggable dimensional scorer. `score` is the contract: |
| `JudgeDimension` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `JudgeScore` | interface | The canonical judge verdict shape — one declaration, shared by campaign |
| `LabeledScenarioRecord` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LabeledScenarioSampleArgs` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LabeledScenarioStore` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LabeledScenarioWrite` | interface | Required-provenance write. The store rejects writes that |
| `LlmJudgeOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopProvenanceBackend` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopProvenanceCandidate` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `LoopProvenanceRecord` | interface | The durable provenance record. Aligns to the hosted `EvalRunEvent` path but |
| `MemoryCurationProposerOptions` | interface | `memoryCurationProposer` — a CURATOR `SurfaceProposer`, the complement to the |
| `Mutator` | interface | Stateless surface mutation — given findings + current |
| `OpenAutoPrOptions` | interface | `openAutoPr` — thin shell-out helper for the `runImprovementLoop` preset's |
| `OpenAutoPrResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `OptimizerConfig` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `OptimizerEntryConfig` | interface | Shared corpus + transport for the three built-in optimizer entries. |
| `PairedHoldout` | interface | Statistical held-out promotion machinery — the trustworthy core the |
| `ParameterCandidate` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ParameterChange` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ParameterSweepProposerOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ParetoParent` | interface | A non-dominated parent on the GEPA Pareto frontier — a |
| `ParetoSignificanceGateOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `PlaybackContext` | interface | Dispatch context plus the profile under test (which cheap model, etc.). |
| `PlaybackDriver` | interface | Drives the real product through a story and returns the runtime event stream |
| `PlaybackStep` | interface | One step of a user story — what the user does. The driver interprets |
| `ProfileSummary` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `PromotionObjective` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ProposeContext` | interface | Everything a proposer may read to plan the next |
| `ProposedCandidate` | interface | A proposer output carrying the surface AND the WHY behind |
| `ProposePatchesArgs` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ProposerComparison` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ProposerEntry` | interface | What an optimizer produced: the surface it promoted + what it cost to get |
| `ProposerPairwise` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ProposerScore` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RejectedEdit` | interface | A patch that was tried and not accepted — fed back to the model so it does |
| `RunCampaignOptions` | interface | `runCampaign` — Pass A substrate primitive. ONE function that orchestrates |
| `RunEvalOptions` | interface | `runEval` — the simplest preset over `runCampaign`. No optimizer, no |
| `RunImprovementLoopResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunOptimizationResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunProfileMatrixOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunProfileMatrixResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunSkillOptOptions` | interface | `runSkillOpt` — the SkillOpt epoch hill-climb (Microsoft, arXiv:2605.23904). |
| `RunSkillOptResult` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `Scenario` | interface | Stable identifier + kind tag for any scenario. Consumers |
| `ScenarioAggregate` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ScenarioRollup` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ScoreboardRenderOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `ScoreboardRow` | interface | One row of the launch scoreboard — story × requirement → PASS/FAIL. |
| `ScoreboardSummary` | interface | Launch-readiness headline counts rolled up from the per-requirement rows. |
| `SequentialDecideFn` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SequentialDecideOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SequentialObservation` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SequentialPairedGate` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SequentialPairedGateOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SessionScript` | interface | One session within a multi-session journey. Dispatch is |
| `SkillOptEpochRecord` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SkillOptEvidence` | interface | Evidence the optimizer reflects on: where the current surface is weakest. |
| `SkillOptProposer` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SkillOptProposerOptions` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SkillPatch` | interface | A named, attributable bundle of ops the optimizer proposes as one edit. |
| `SkillPatchRejection` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `SurfaceProposer` | interface | A surface-improvement strategy. Given the current best |
| `TraceAnalystProposerOptions` | interface | `traceAnalystProposer` — wraps agent-eval's OWN trace-analyst engine |
| `TraceSpan` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `UserStory` | interface | A user story = a runnable product journey plus the requirements that define |
| `UserStoryVerdict` | interface | A scored user story — the completion verdict plus its human title. |
| `Worktree` | interface | VCS-pluggable worktree adapter. One improvement = one worktree, PR-like |
| `WorktreeAdapter` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `AxisVerdict` | type | Per-axis verdict from the good-direction paired bootstrap. |
| `CampaignTokenUsage` | type | Token usage accumulated for a cell. Aliased to the canonical `RunTokenUsage` |
| `DispatchFn` | type | One function: scenario + ctx → artifact. Dispatcher chooses |
| `FapoOptimizationLevel` | type | FAPO (Fully Autonomous Prompt Optimization) is an orchestration policy, not |
| `GateDecision` | type | Five-valued verdict taxonomy (MOSS-paper alignment). |
| `JsonPrimitive` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `JsonValue` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `LabeledScenarioSource` | type | Source tag — required on every store write. Used by the |
| `LabelTrust` | type | How much a label can be trusted to evaluate against — the gold-admission |
| `LlmJudgeDimension` | type | A rubric dimension as a bare key or the full `{ key, description }` shape. A |
| `MutableSurface` | type | The mutable surface a proposer changes. Tiers (see |
| `ObjectiveSource` | type | Where an objective's per-cell scalar comes from. `composite` reads the |
| `OptimizationProposer` | type | Optional vocabulary alias. The loop is the optimizer; this object is the |
| `ProfileDispatchFn` | type | Dispatch for one cell: render `profile` against `scenario`, returning the |
| `PromotionPolicy` | type | A promotion strategy: a pure function from the evidence vector to a verdict. |
| `RedactionStatus` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `RunImprovementLoopOptions` | type | `runImprovementLoop` — the gated-promotion shell around the improvement |
| `RunOptimizationOptions` | type | _(no summary — add a TSDoc line at the declaration)_ |
| `SequentialDecision` | type | Anytime-valid sequential promotion gate — an e-process (betting |
| `SkillPatchOp` | type | A single bounded edit against a skill surface. |

### TOKEN / USAGE — usage extraction + run-record usage types

Import from `@tangle-network/agent-eval` — 5 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `extractUsage` | function | Pull `{ input, output, cached? }` from a parsed chat-completions response |
| `extractUsageFromResponse` | function | Extract usage from an HTTP `Response` without consuming the caller's body: |
| `extractUsageFromSse` | function | Sum token usage across an SSE response body. Each `data:` line is parsed and |
| `LlmUsage` | interface | _(no summary — add a TSDoc line at the declaration)_ |
| `RunTokenUsage` | interface | _(no summary — add a TSDoc line at the declaration)_ |
