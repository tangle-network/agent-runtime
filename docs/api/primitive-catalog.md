<!--
  GENERATED — do not edit. Run `pnpm run docs:api` to regenerate.
  Source: scripts/gen-primitive-catalog.mjs reads the LIVE exports of this
  package + the @tangle-network/agent-eval substrate via the TypeScript compiler.
  A live export missing here = a RED BUILD (scripts/check-docs-freshness.mjs).
-->

# Primitive catalog — the never-stale anti-reinvention inventory

> **GENERATED** from `@tangle-network/agent-runtime@0.106.0` and `@tangle-network/agent-eval@0.129.0` by `scripts/gen-primitive-catalog.mjs`. Do NOT hand-edit — run `pnpm run docs:api`. This is the mechanical companion to the JUDGMENT in `canonical-api.md` (§2 decision table + §1.5 AgentProfile law): that doc says WHICH primitive to reach for and what NOT to build; this catalog proves WHAT exists. Per-symbol signatures + `file:line` live in the per-module pages under `docs/api/`.

## 1. agent-runtime — own public surface

Every subpath this package declares in `package.json` `exports`. Reach for these before hand-rolling a loop, driver, conversation runner, optimizer wrapper, or observability shim.

### Core agent execution and improvement

Import from `@tangle-network/agent-runtime` — 336 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `agenticGenerator` | function | Full-agentic `CandidateGenerator` (the `shots=N, sandbox=on` setting): run a real coding harness inside the candidate worktree so the agent makes the change in place. |
| `applyExactAgentProfileDiff` | function | Apply one exact diff and reject any value that cannot be preserved canonically. |
| `applyRolloutPolicyToProfile` | function | Persist a detached policy under the profile extension without mutating the input. |
| `assertCandidateProfileBinding` | function | Prove the measured generic profile and sealed candidate profile describe the same behavior. |
| `auditLoopRunner` | function | `audit` mode — analyst loop over captured trace/run data. |
| `buildAgentCandidateBundle` | function | Compile one measured profile/code candidate into the immutable execution |
| `buildKnowledgeImprovementExperimentBundles` | function | Attach both frozen knowledge inputs to one otherwise-identical bundle pair. |
| `buildLoopOtelSpans` | function | Build a nested, real-duration OTLP span tree for ONE loop run from its full |
| `buildLoopSpanNodes` | function | Sink-neutral core behind {@link buildLoopOtelSpans}: reconstruct the |
| `buildRuntimeEventOtelSpans` | function | Convert normalized runtime events into lossless, redacted child spans. |
| `candidateExecutionClaim` | function | Extract the complete durable claim from a prepared execution. |
| `candidateKnowledgeExecutionPaths` | function | Deterministic, signed locations used by every candidate executor. |
| `captureAgentCandidateWorkspace` | function | Capture one exact regular-file workspace for immutable candidate execution. |
| `captureAgentCandidateWorkspaceFiles` | function | Capture detached files returned by a remote executor into the standard archive. |
| `cleanModelId` | function | Trim a candidate model id; `undefined` for non-strings and blanks. |
| `commandVerifier` | function | A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other |
| `composeRuntimeHooks` | function | Merge several {@link RuntimeHooks} into one. Falsy entries are dropped (so you can |
| `createAgentCandidateWorkspacePort` | function | Create the standard bounded materializer for candidate execution ports. |
| `createAgentKnowledgeReadinessCheck` | function | Build the default readiness check backed by `@tangle-network/agent-knowledge` validation and scoring. |
| `createKnowledgeImprovementActivationExecutor` | function | Apply or restore one local knowledge candidate through the shared activation contract. |
| `createOtelExporter` | function | Create an OTEL exporter. Returns undefined when no endpoint is configured. |
| `createProtectedAgentCandidateModelPort` | function | Bind a protected model-grant service to the immutable candidate runtime. |
| `createRuntimeStreamEventCollector` | function | Collect redacted runtime events and a small summary. |
| `createSupervisedKnowledgeUpdater` | function | Create an `improveKnowledgeBase` update callback backed by runtime supervision. |
| `d1SqlAdapter` | function | Adapt a Cloudflare D1 database to the interaction journal SQL contract. |
| `defaultBuildPrompt` | function | Turn the analyst's findings (+ optional report) into a concrete coder task — |
| `defineRuntimeHooks` | function | Identity helper that types a {@link RuntimeHooks} literal so the fields are inferred. |
| `deriveExecutionId` | function | Derive a stable executionId from the run identity. The same |
| `disposePreparedAgentCandidateExecution` | function | Revoke reservations held by a prepared candidate that will not be executed. |
| `driverLoopGenerator` | function | Driver→worker `CandidateGenerator`: an LLM driver on the canonical tool-loop authors, observes, rates, and steers coding-harness sessions in the worktree until the verifier passes or the session budge |
| `encodeServerSentEvent` | function | Serialize a value as one Server-Sent Event record. |
| `exactProcessProviderAsCandidateExecutor` | function | Adapt one neutral exact-process provider to Runtime's trusted candidate boundary. |
| `executePreparedAgentCandidate` | function | Executes and finalizes one durably claimed candidate without exposing an unproven result. |
| `exportEvalRuns` | function | Ship self-improvement eval-run events to Tangle Intelligence and return the |
| `findingLines` | function | Render findings as the ranked-evidence block every build prompt ends with. |
| `formatSupervisedKnowledgeTask` | function | Format the supervisor task with the KB root, readiness requirements, current findings, and metadata. |
| `getModels` | function | Fetch the model catalog from the router's `/v1/models`. Throws on a non-2xx |
| `handleChatTurn` | function | Run one chat turn. Returns immediately with a `ReadableStream` body; |
| `improve` | function | Optimize one exact profile surface with a complete method. |
| `isAnalystFinding` | function | Structural guard for the schema-versioned `AnalystFinding` envelope. |
| `isDelegatedLoopMode` | function | Type guard — returns true when `value` is a valid `DelegatedLoopMode` string. |
| `knowledgeReadinessDeliverable` | function | Build the completion check a supervised KB update uses to stop only when the KB is ready. |
| `loopEventToOtelSpan` | function | Convert a LoopTraceEvent into an OtelSpan for export. |
| `mcpBuildPrompt` | function | Build the starting instruction for a coder agent tasked with implementing a new MCP server. |
| `mcpServeVerifier` | function | Build a `Verifier` that boots a generated MCP server over stdio and checks it exposes tools. |
| `mcpToolsForRuntimeMcp` | function | Returns the queue-bound delegation tools projected into OpenAI Chat |
| `mcpToolsForRuntimeMcpSubset` | function | Subset filter — return only the projected tools whose `function.name` |
| `normalizeRolloutPolicy` | function | Normalize an untyped policy bag (a parsed surface or a profile extension) into |
| `notifyRuntimeDecisionPoint` | function | Fire `hooks.onDecisionPoint`, swallowing sync throws and surfacing async failures to `onError`. |
| `notifyRuntimeHookEvent` | function | Fire `hooks.onEvent`, swallowing sync throws and surfacing async failures to `onError`. |
| `officialGepa` | function | Build a complete method backed by GEPA's official Optimize Anything API. |
| `officialSkillOpt` | function | Build a complete method backed by Microsoft's official SkillOpt trainer. |
| `parseExactAgentProfile` | function | Parse a complete profile without silently discarding unsupported fields. |
| `parseExactAgentProfileDiff` | function | Parse a profile diff without silently discarding unsupported fields. |
| `parseLoopRunnerArgv` | function | Parse `--mode X --config Y` from an argv tail (`process.argv.slice(2)`). |
| `parseRolloutPolicy` | function | Parse a serialized policy surface. Returns `undefined` for non-strings, |
| `persistCandidateOutputArtifact` | function | Persist evaluator evidence, read it back, and bind the returned locator to the exact bytes. |
| `prepareAgentCandidateExecution` | function | Materializes a verified candidate into one immutable evaluator-owned execution plan. |
| `rawTraceDistiller` | function | Build an `analyzeGeneration` producer that feeds the proposer RAW-TRACE |
| `recoverExpiredAgentCandidateExecution` | function | Close an expired crashed attempt from persisted non-secret handles, then record failure. |
| `reflectiveGenerator` | function | Cheap no-sandbox `CandidateGenerator` (the `shots=1` setting): draft surface edits via the improvement adapter and apply them as one coherent candidate. |
| `researchLoopRunner` | function | `research` mode — research-in-a-loop with valid-only KB growth. |
| `resolveChatModel` | function | Resolve a chat model by precedence: the first candidate carrying a |
| `resolveRouterBaseUrl` | function | Resolve the router base URL from env, normalised — no trailing `/v1` or `/`. |
| `runDelegatedLoop` | function | Dispatch a configured loop by mode. Fails loud (throws `ConfigError`) when no |
| `runInteraction` | function | Run a bounded, resumable interaction and return its final state. |
| `runKnowledgeImprovementJob` | function | Produce a frozen KB candidate while leaving live knowledge content unchanged. |
| `runLoopRunnerCli` | function | Pure CLI core (no process / argv / IO) so it's unit-testable: validate the |
| `runSupervisedKnowledgeUpdate` | function | Run a runtime supervisor that updates one candidate knowledge base and stops on readiness. |
| `runtimeStreamServerSentEvent` | function | Serialize a `RuntimeStreamEvent` as a Server-Sent Event string. |
| `runToolLoop` | function | Run the bounded tool loop and return the final text + every executed tool |
| `sanitizeRuntimeStreamEvent` | function | Convert one runtime event into a redacted plain object. |
| `sealAgentCandidateBundle` | function | Validate and content-address a candidate bundle before it crosses an approval boundary. |
| `serializeRolloutPolicy` | function | Stable serialization with fixed field order. |
| `startRuntimeRun` | function | Construct a runtime-run handle. The returned handle is mutable across its |
| `streamInteraction` | function | Stream every event from a bounded, resumable interaction. |
| `streamToolLoop` | function | Streaming bounded tool loop: yields each raw turn event (the caller maps + |
| `structuralRolloutPolicyFromProfile` | function | Read the persisted policy off the profile. `undefined` when the profile does |
| `toAnalystFindings` | function | Normalize a mixed `unknown[]` findings array to `AnalystFinding[]`: |
| `toolBuildPrompt` | function | Build the starting instruction for a coder agent tasked with implementing a new tool. |
| `validateChatModelId` | function | Validate a caller-supplied chat-model id. Rejects non-strings, malformed |
| `verifyAgentCandidateBundle` | function | Verifies every digest, resource, workspace, and Git object in a candidate bundle. |
| `worktreeLoopRunner` | function | Run coding profiles in isolated worktrees and return the selected valid patch. |
| `AGENT_CANDIDATE_EXECUTION_SUPPORT` | const | Surfaces admitted by Runtime's verifier before an environment adapter is selected. |
| `AGENTIC_PROFILE_RESOURCE_ROOT` | const | Dedicated ephemeral root for generic author-profile files. Every declared |
| `buildDriverSystem` | const | The driver's stance for `driverLoopGenerator` — the build-domain instance of |
| `CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV` | const | Environment variable containing the materialized retrieval configuration path. |
| `CANDIDATE_KNOWLEDGE_ROOT_ENV` | const | Environment variable containing the materialized candidate knowledge root. |
| `CANDIDATE_TRACE_ENV` | const | Environment keys used to propagate immutable candidate trace identity. |
| `CANDIDATE_TRACE_TAGS` | const | Protected trace tags that bind a run to one prepared candidate execution. |
| `DEFAULT_ROUTER_BASE_URL` | const | Default Tangle Router base URL used when no env override is set. |
| `DELEGATED_LOOP_MODES` | const | All valid delegated-loop mode names — used for validation and CLI surfaces. |
| `INTELLIGENCE_WIRE_VERSION` | const | Wire version the eval-runs ingest enforces (X-Tangle-Wire-Version + body). |
| `LIFTED_FINDING_ANALYST_ID` | const | Analyst id stamped on findings lifted from untyped seed values. |
| `optimizerMethod` | const | The shared method block every build/author prompt embeds. Domain framing |
| `RESEARCH_SUPERVISOR_SYSTEM_PROMPT` | const | Standing prompt for a supervisor that grows a shared knowledge base through spawned researchers. |
| `researchDriverNote` | const | The driver's ADOPT-not-build doctrine, appended to `buildDriverSystem` when |
| `ROLLOUT_POLICY_EXTENSION` | const | The profile extensions namespace the policy persists under. |
| `strategyAuthorMethod` | const | The senior authoring process for `authorStrategy` — the same method, shaped |
| `AgentEvalError` | class | Base class for every contract error this package throws — carries the stable |
| `CircuitBreakerState` | class | Tracks consecutive actor failures and the configured recovery period. |
| `CircuitOpenError` | class | Reports that an actor is temporarily blocked after repeated failures. |
| `ConfigError` | class | Configuration missing or malformed (`HOME` unset, required image not supplied, env var absent). |
| `FileAgentCandidateExecutionClaimStore` | class | Cross-process lifecycle implemented as fsynced, create-if-absent records. |
| `FileInteractionJournal` | class | Persist resumable interaction state in a local JSON file. |
| `InMemoryAgentCandidateExecutionClaimStore` | class | Single-process lifecycle implementation. |
| `InMemoryInteractionJournal` | class | Store resumable interaction state in process memory. |
| `JudgeError` | class | A judge call failed in a way that's not retryable: schema parse failure, bad rubric, conflicting dimensions. |
| `NotFoundError` | class | A named resource (run, span, rubric, scenario, dataset row, route) does not exist. |
| `OfficialOptimizerUnavailableError` | class | Missing optional Python dependencies for an official optimizer. |
| `PlannerError` | class | The dynamic-loop planner returned an unusable topology move — the LLM emitted |
| `RuntimeRunStateError` | class | A runtime-run lifecycle method was called in an order the state machine does |
| `SqlInteractionJournal` | class | Persist resumable interaction state in a SQL database. |
| `TurnTimeoutError` | class | Reports that an actor did not finish its turn before the configured timeout. |
| `ValidationError` | class | Caller passed invalid arguments (out of range, mutually-exclusive options, bad shape). |
| `AgentCandidateArtifactPort` | interface | Reads one content-addressed object from the closed S3/IPFS locator set. |
| `AgentCandidateBenchmarkGraderIdentity` | interface | Immutable grader identity admitted for one benchmark task. |
| `AgentCandidateBenchmarkGraderPort` | interface | Evaluator-owned executable grader, pinned by immutable implementation bytes. |
| `AgentCandidateCodeSurfaceSource` | interface | The only accepted path from an agent-eval code candidate to executable bytes. |
| `AgentCandidateExecutionAttemptRecord` | interface | Persisted state available to a fresh trusted recovery worker after a crash. |
| `AgentCandidateExecutionClaim` | interface | Immutable signed identity stored for one execution attempt. |
| `AgentCandidateExecutionClaimStore` | interface | Atomic one-shot store for candidate execution attempts. |
| `AgentCandidateExecutionCleanupHandles` | interface | Non-secret identities a trusted recovery worker needs to close an abandoned attempt. |
| `AgentCandidateExecutionLease` | interface | Secret capability required to finish the acquired attempt. |
| `AgentCandidateExecutionRecoveryEvidence` | interface | Trusted, independently observed closure facts for one expired winning lease. |
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
| `BuildAgentCandidateBundleInput` | interface | Complete measured surfaces and execution policy compiled into one candidate bundle. |
| `CandidateGenerator` | interface | The byte-producing seam — the ONE thing that differs between the cheap |
| `ChatStreamEvent` | interface | The NDJSON line protocol every product chat client already speaks. |
| `ChatTurnIdentity` | interface | Identity of a chat turn. `tenantId` is the workspace id for workspace- |
| `ChatTurnProducer` | interface | The live side of a turn — what the product's `produce` hook returns. |
| `DriverLoopGeneratorOptions` | interface | `driverLoopGenerator` — the driver→worker `CandidateGenerator`: the build |
| `ImproveCandidateValidationInput` | interface | Exact materialized profile presented for validation before any candidate run. |
| `ImproveCost` | interface | Normalized spend reported for one Runtime improvement run. |
| `ImproveLineage` | interface | Optimizer ancestry sealed into downstream candidate experiments. |
| `ImproveProfileComponents` | interface | Caller-owned mapping for optimizing several profile fields as one candidate. |
| `LoopSpanNode` | interface | Sink-neutral node in a reconstructed loop span tree. The root node's |
| `McpServeSpec` | interface | `mcpServeVerifier` — the intrinsic verifier for a built MCP server: the |
| `ModelInfo` | interface | A model entry as returned by the Tangle Router `/v1/models` endpoint. |
| `OfficialOptimizerContextOptions` | interface | Runtime context appended to an official optimizer's own configuration. |
| `OpenAIChatTool` | interface | OpenAI Chat Completions tool descriptor. The shape mirrors the |
| `OtelExportConfig` | interface | OTEL span exporter — streams LoopTraceEvents to an OTLP/HTTP collector. |
| `OtelFlushResult` | interface | Lifetime delivery totals observed when an explicit flush settles. |
| `PreparedAgentCandidateKnowledge` | interface | Exact file-backed knowledge admitted by the candidate bundle. |
| `RawTraceDistillerOptions` | interface | `rawTraceDistiller` — the meta-harness `analyzeGeneration` producer. |
| `ReflectiveGeneratorOptions` | interface | `reflectiveGenerator` — the cheap, no-sandbox `CandidateGenerator`. It drafts |
| `RouterEnv` | interface | Env keys the router base URL is resolved from. |
| `RuntimeHooks` | interface | The observation seam attached to a running loop (never to the portable genome). |
| `RuntimeTelemetryOptions` | interface | Opt-ins for fields that may contain user or tenant data. |
| `ToolLoopAssistantToolCall` | interface | One OpenAI-shaped tool-call entry carried on an assistant message. |
| `ToolLoopCall` | interface | Bounded turn-level tool-dispatch loop. |
| `VerifyResult` | interface | Outcome of verifying a candidate worktree. `feedback` (compiler errors, |
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
| `AgentCandidateModelGrantReservation` | type | Secret-free response from the service's reservation endpoint. |
| `AgentCandidateModelLimits` | type | Limits mechanically enforced by the evaluator-owned model gateway. |
| `AgentCandidateProfileSource` | type | A complete profile that can be frozen without losing behavior. |
| `AgentEvalErrorCode` | type | Error taxonomy for `@tangle-network/agent-eval`. |
| `AgenticGeneratorShotDisposition` | type | Worktree decision emitted before a completed shot is retried, accepted, or |
| `AgenticGeneratorShotExecution` | type | Frozen exact harness result for an author shot: full streams, process state, |
| `ImproveCodeRunOptions` | type | Runtime-owned code search in isolated git worktrees. |
| `ImproveMethodFactory` | type | Build a complete method after trace findings are available. |
| `ImproveMethodOptions` | type | Complete-method configuration for every non-code profile surface. |
| `ImproveOptions` | type | The canonical improvement API: complete methods for profiles, worktrees for code. |
| `ImproveProfileAgent` | type | Runs one exact materialized profile on one scenario. |
| `ImproveSurface` | type | The executable agent lever `improve` optimizes. Profile fields remain |
| `OfficialGepaOptions` | type | Official GEPA configuration plus bounded Runtime findings context. |
| `OfficialSkillOptOptions` | type | Official SkillOpt configuration plus bounded Runtime findings context. |
| `OpenAIChatResponseFormat` | type | `response_format` parameter for OpenAI-compatible chat endpoints. Use |
| `OpenAIChatToolChoice` | type | `tool_choice` parameter for OpenAI-compat chat. Same shape as the OpenAI |
| `ReadonlyAgentProfile` | type | Complete immutable profile value used during measured execution. |
| `RuntimeHookPhase` | type | Runtime hook contracts. Hooks are execution-scoped observers, not part of an |
| `ToolCallOutcome` | type | Outcome of one tool dispatch — structurally compatible with a hub/integration |
| `ToolLoopMessage` | type | A message in the running conversation the loop sends to `streamTurn`. |
| `ToolLoopStopReason` | type | Why the loop stopped. `completed` = model finished naturally; `stuck-loop` = |
| `VerifiedAgentCandidateTaskOutcome` | type | Branded task outcome that has survived independent evaluator verification. |
| `Verifier` | type | Verifies the edited worktree. Sync or async; throws only on a setup fault |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentCandidateContainerPort`, `AgentCandidateExecutionAttemptRef`, `AgentCandidateExecutionPorts`, `AgentCandidateExecutorWorkspaceFile`, `AgentCandidateExecutorWorkspaceInput`, `AgentCandidateMemoryPort`, `AgentCandidateMemoryResetResult`, `AgentCandidateModelPort`, `AgentCandidatePreparationEvidence`, `AgentCandidateProtectedModelActivation`, `AgentCandidateProtectedModelReservation`, `AgentCandidateProtectedModelSettlement`, `AgentCandidateProtectedRunCapture`, `AgentCandidateVerificationPorts`, `AgentCandidateWorkspaceArchiveLimits`, `AgenticGeneratorOptions`, `AgenticGeneratorShotReceipt`, `AgentKnowledgeReadinessCheckOptions`, `AgentTaskSpec`, `AgentTurnError`, `CanonicalCandidateDocument`, `CaptureAgentCandidateWorkspaceOptions`, `CapturedAgentCandidateWorkspace`, `ChatTurnHooks`, `ChatTurnResult`, `CircuitBreakerConfig`, `CreateAgentCandidateWorkspacePortOptions`, `CreateKnowledgeImprovementActivationExecutorOptions`, `CreateProtectedAgentCandidateModelPortOptions`, `D1DatabaseLike`, `D1StatementLike`, `DelegatedLoopResult`, `DisposePreparedAgentCandidateOptions`, `EvalRunEvent`, `EvalRunGeneration`, `EvalRunsExportConfig`, `EvalRunsExportResult`, `ExactProcessCandidateExecutorOptions`, `ExecutePreparedAgentCandidateOptions`, `FileAgentCandidateExecutionClaimStoreOptions`, `ImproveCodeOptions`, `ImproveCodeResult`, `ImprovementCodeCandidate`, `ImprovementProfileCandidate`, `ImproveMethodContext`, `ImproveMethodResult`, `ImproveSkillsOptions`, `InteractionActor`, `InteractionActorRef`, `InteractionDriveState`, `InteractionJournal`, `InteractionJournalEntry`, `InteractionPolicy`, `InteractionResult`, `InteractionStop`, `InteractionTurn`, `KnowledgeImprovementActivationExecutor`, `KnowledgeImprovementCandidatePair`, `KnowledgeImprovementExperimentBundles`, `KnowledgeImprovementJobMeasurement`, `KnowledgeImprovementJobResult`, `KnowledgeReadinessCheckInput`, `LoopRunnerCliArgs`, `LoopRunnerCliResult`, `OfficialSensitiveCandidateInput`, `OtelAttribute`, `OtelDropEvent`, `OtelExporter`, `OtelSpan`, `PrepareAgentCandidateExecutionOptions`, `PreparedAgentCandidateExecution`, `PreparedAgentCandidateInstruction`, `PreparedAgentCandidateLaunch`, `PreparedAgentCandidateTrace`, `RecoverExpiredAgentCandidateOptions`, `ResearchLoopResult`, `ResearchLoopRunnerOptions`, `ResolvedAgentCandidateContainer`, `ResolvedChatModel`, `RunChatTurnInput`, `RunDelegatedLoopOptions`, `RunInteractionOptions`, `RunKnowledgeImprovementJobOptions`, `RuntimeDecisionEvidenceRef`, `RuntimeDecisionPoint`, `RuntimeEventOtelOptions`, `RuntimeHookContext`, `RuntimeHookErrorContext`, `RuntimeHookEvent`, `RuntimeRunHandle`, `RuntimeRunPersistenceAdapter`, `RuntimeRunRow`, `RuntimeStreamEventCollector`, `RuntimeStreamEventSummary`, `RunToolLoopOptions`, `SqlAdapter`, `StreamToolLoopOptions`, `SupervisedKnowledgeUpdateInput`, `SupervisedKnowledgeUpdateOptions`, `SupervisedKnowledgeUpdateResult`, `ToAnalystFindingsOptions`, `ToolLoopResult`, `TurnCallPolicy`, `VerifiedAgentCandidate`, `VetoedFact`, `WorktreeLoopRunnerOptions`, `AgentCandidateModelGrantActivateInput`, `AgentCandidateModelGrantReserveInput`, `AgentCandidateModelGrantSettleInput`, `AgentCandidateOutputPurpose`, `AgentCandidateRetryRejection`, `AgentCandidateRunFinalization`, `AgentTaskStatus`, `DeepReadonly`, `DelegatedLoopMode`, `DelegatedLoopRegistry`, `DelegatedLoopRunner`, `ImproveCandidateValidator`, `ImprovementCandidate`, `ImproveMethodSource`, `ImproveOptimizationRunOptions`, `ImproveProfileSurface`, `ImproveResult`, `InteractionEnvironmentOptions`, `InteractionHaltReason`, `InteractionStopPredicate`, `InteractionStreamEvent`, `InteractionTurnOptions`, `InteractionTurnOrder`, `KnowledgeReadinessCheck`, `KnowledgeReadinessCheckResult`, `RetryableErrorPredicate`, `RetryBackoff`, `RuntimeDecisionKind`, `RuntimeHookTarget`, `RuntimeStreamEvent`, `RuntimeStreamEventSink`, `StreamToolLoopYield`, `SupervisedKnowledgeUpdater`, `ToolLoopEvent`.

### Agent manifests and improvement proposals

Import from `@tangle-network/agent-runtime/agent` — 32 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `assertProfileMaterialization` | function | Throw when a candidate changes axes the selected run path cannot carry. |
| `collectAgentRun` | function | Collect a streamed agent run and its final output. |
| `createEnvironmentAct` | function | Build an evaluation callback backed by one production-profile environment |
| `createSurfaceImprovementProposer` | function | Resolve each finding to a real surface and draft a detached patch candidate. |
| `defineProfileMaterializationContract` | function | Define the profile axes a concrete run path actually carries into execution. |
| `renderImprovementPathIssues` | function | Format improvement-path errors for logs and command output. |
| `renderProfileMaterializationIssues` | function | Format profile-axis drop issues into a concise operator-facing error. |
| `resolveSubjectPath` | function | Resolve a parsed finding subject to one declared repository path. |
| `validateImprovementPaths` | function | Validate every path the application explicitly declared. |
| `validateProfileMaterialization` | function | Return every changed profile axis that the selected run path would drop. |
| `AGENT_PROFILE_MATERIALIZATION_AXES` | const | Known AgentProfile axes a run path may or may not carry into execution. |
| `environmentActProfileMaterialization` | const | Profile fields consumed by `createEnvironmentAct`. |
| `promptOnlyProfileMaterialization` | const | Materialization contract for a run path that only injects prompt text. |
| `promptResourceProfileMaterialization` | const | Materialization contract for a run path that injects prompt text plus inline resources. |
| `AgentImprovementPaths` | interface | Repository paths an improvement job may edit. |
| `AssertProfileMaterializationOptions` | interface | Input for throwing on dropped profile axes. |
| `DefineProfileMaterializationContractOptions` | interface | Input for declaring a run path's profile-axis support. |
| `EnvironmentActComposeOverrides` | interface | Per-persona profile-merge slots applied over the base profile (§1.5: the caller authors the |
| `ProfileMaterializationContract` | interface | Declares which AgentProfile axes a concrete run path really carries. |
| `ProfileMaterializationIssue` | interface | One changed AgentProfile axis that would be dropped by a run path. |
| `SurfaceImprovementEdit` | interface | Surface improvement proposer — resolves analyst findings into LLM-drafted |
| `ValidateProfileMaterializationOptions` | interface | Input for checking a candidate diff against a run path. |
| `AgentProfileMaterializationAxis` | type | AgentProfile axis name, with `custom:<name>` reserved for caller-owned extensions. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentRunContext`, `AgentRunInvocation`, `CreateEnvironmentActOptions`, `CreateSurfaceImprovementProposerOptions`, `DraftPatchInput`, `DraftPatchOutput`, `ImprovementPathIssue`, `ResolvedImprovementPath`, `KnownAgentProfileMaterializationAxis`.

### Persistent multi-agent interactions

Import from `@tangle-network/agent-runtime/interaction` — 32 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `d1SqlAdapter` | function | Adapt a Cloudflare D1 database to the interaction journal SQL contract. |
| `runInteraction` | function | Run a bounded, resumable interaction and return its final state. |
| `streamInteraction` | function | Stream every event from a bounded, resumable interaction. |
| `CircuitBreakerState` | class | Tracks consecutive actor failures and the configured recovery period. |
| `CircuitOpenError` | class | Reports that an actor is temporarily blocked after repeated failures. |
| `FileInteractionJournal` | class | Persist resumable interaction state in a local JSON file. |
| `InMemoryInteractionJournal` | class | Store resumable interaction state in process memory. |
| `SqlInteractionJournal` | class | Persist resumable interaction state in a SQL database. |
| `TurnTimeoutError` | class | Reports that an actor did not finish its turn before the configured timeout. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `CircuitBreakerConfig`, `D1DatabaseLike`, `D1StatementLike`, `InteractionActor`, `InteractionActorRef`, `InteractionDriveState`, `InteractionJournal`, `InteractionJournalEntry`, `InteractionPolicy`, `InteractionResult`, `InteractionStop`, `InteractionTurn`, `RunInteractionOptions`, `SqlAdapter`, `TurnCallPolicy`, `InteractionEnvironmentOptions`, `InteractionHaltReason`, `InteractionStopPredicate`, `InteractionStreamEvent`, `InteractionTurnOptions`, `InteractionTurnOrder`, `RetryableErrorPredicate`, `RetryBackoff`.

### Intelligence client and billing controls

Import from `@tangle-network/agent-runtime/intelligence` — 129 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `agentImprovementProfileSurfaceDigest` | function | Return the `Sha256Digest` of one profile surface using Runtime's canonical candidate digest. |
| `agentImprovementProfileSurfaceInput` | function | Return the canonical current-state input for one profile-deliverable improvement target. |
| `agentImprovementTargetProfileDiffs` | function | Replace one measured profile surface exactly, including array-valued resources. |
| `buildAgentImprovementActivationTargets` | function | Bind caller-owned target identities to the exact source state Runtime measured. |
| `compileEffort` | function | Compile resolved `EffortSettings` into the orchestration overrides above. Pure: same |
| `composeCertifiedContext` | function | Materialize current certified context without creating executable behavior. |
| `createAgentImprovementActivation` | function | Authorize product-owned writes only after the exact candidate was measured and approved. |
| `createAgentImprovementActivationResult` | function | Create the exact result a product stores in the same transaction as its target write. |
| `createAgentImprovementMeasuredComparison` | function | Delegate all statistics and promotion checks to agent-eval's receipt-based comparison. |
| `createAgentImprovementProposal` | function | Create the reviewable record only from a complete, recomputable experiment result. |
| `createCertifiedContextSource` | function | Create one coalesced cache that keeps the last valid context response. |
| `createExactProcessCandidateExperimentExecutor` | function | Execute one signed experiment cell through any declared exact-process provider. |
| `createIntelligenceClient` | function | Create an Observe-mode Intelligence client. Resolves effort, the base URL, and |
| `createOptimizationActivationReceipt` | function | Build a detached receipt only for methods backed by an identified external optimizer. |
| `createProtectedExactProcessCandidateExperimentExecutor` | function | Compose host-owned execution ports with protected model access for one exact-process run. |
| `defaultRedactor` | function | The built-in redactor. Walks objects and arrays; replaces values under |
| `executeAgentCandidateExperimentCell` | function | Execute one exact arm, task, repetition, seed, and attempt through Runtime. |
| `executeAgentImprovementActivation` | function | Validate and execute one product-owned activation transition. |
| `isAgentImprovementProfileSurface` | function | Return whether a measured surface can be delivered through an agent profile. |
| `isIntelligenceOff` | function | True when these settings admit NO intelligence spawn — the passthrough |
| `optimizationActivationReceiptFromMetadata` | function | Read and verify the optimizer evidence carried by a measured proposal. |
| `parseCandidateProfileMaterialization` | function | Parse and check every native file hash plus both canonical document digests. |
| `prepareAgentImprovementProfileActivation` | function | Compare product-owned profiles with an exact measured transition and prepare |
| `proposeAgentImprovement` | function | Analyze, search, then remeasure the resulting exact candidate before proposing it. |
| `pullCertifiedContext` | function | Pull certified context for a target. Fail-closed: a network |
| `resolveEffort` | function | Compile a named tier (plus optional per-field overrides) into the flat |
| `resolveIntelligenceBaseUrl` | function | Resolve the Intelligence base URL used by both send and receive paths. |
| `resolveRedactor` | function | Resolve the redactor a client uses. A caller-supplied hook handles |
| `reviewAgentImprovementProposal` | function | Persist a human or tenant-policy decision bound to one exact proposal. |
| `runAgentCandidateExperiment` | function | Execute both arms of one immutable experiment and derive its paired result. |
| `submitAgentImprovementProposal` | function | Submit a completed Runtime proposal to Intelligence for product-side review. |
| `verifyAgentImprovementActivation` | function | Validate activation authority against the exact proposal, review, experiment, and base state. |
| `verifyAgentImprovementActivationResult` | function | Recompute one historical activation result against the exact measured proposal and authority. |
| `verifyAgentImprovementProposal` | function | Validate a proposal and recompute every binding to its measured experiment. |
| `verifyAgentImprovementReview` | function | Validate the canonical identity and wire shape of an improvement review. |
| `verifyCandidateExecutionEvidence` | function | Recheck one Runtime receipt against its exact signed experiment cell. |
| `withIntelligence` | function | Wrap an agent so it (a) RECEIVES the tenant's certified context — the prompt |
| `AGENT_IMPROVEMENT_PROFILE_SURFACES` | const | Agent improvement surfaces delivered as exact `AgentProfileDiff` replacements. |
| `defaultEffortTier` | const | The default tier when a client declares no effort. `'standard'` turns |
| `exactProcessCandidateExperimentExecutionSupport` | const | Candidate surfaces implemented by the neutral exact-process executor. |
| `AgentCandidateExperimentCellExecutionError` | class | A failed baseline or candidate cell with its complete Runtime failure result. |
| `AgentImprovementActivation` | interface | Authority receipt permitting activation of one already-measured candidate. |
| `AgentImprovementActivationResult` | interface | Immutable outcome of one idempotent, transaction-wide activation attempt. |
| `AgentImprovementMeasuredComparison` | interface | Portable paired held-out comparison produced by a sealed candidate executor. |
| `AgentImprovementReview` | interface | Human or tenant-policy decision bound to one exact proposal. |
| `AppliedIntelligence` | interface | What the hook hands the agent each run. `composePrompt` folds certified |
| `CandidateExecutionEvidence` | interface | Complete execution of one exact experiment attempt. |
| `CandidateProfileMaterialization` | interface | Exact native profile files and the canonical plan that activated them. |
| `CertifiedContext` | interface | Tenant-bound context delivered by Intelligence. |
| `CertifiedContextCheckpoint` | interface | Durable rollback state for one tenant and target. It contains no delivered content. |
| `CertifiedContextCheckpointStore` | interface | Caller-owned durable storage for certified-context rollback protection. |
| `CertifiedContextSource` | interface | A cached, self-refreshing source of one certified context bundle. |
| `CertifiedContextSourceOptions` | interface | Options for {@link createCertifiedContextSource} plus |
| `CreateProtectedExactProcessCandidateExperimentExecutorOptions` | interface | Builds the standard exact-process executor with model access that is scoped, |
| `DoctorReport` | interface | The `doctor()` readiness report — Mode-readiness without any network call. |
| `EffortOverridesCompiled` | interface | The run-config overrides an `EffortSettings` compiles to — the bridge between the |
| `EffortSettings` | interface | The flat, resolved settings a tier compiles to. Every field is individually |
| `IntelligenceClient` | interface | The Observe-mode Intelligence client. |
| `IntelligenceConfig` | interface | Client configuration. `project` + `apiKey` are the Observe minimum; the |
| `IntelligenceHookConfig` | interface | `withIntelligence` config = the Observe config plus tenant, pull target, |
| `ModeReadiness` | interface | One mode's readiness verdict. |
| `ProtectedExactProcessCandidateExperimentExecutor` | interface | Exact-process executor plus the ports required for durable recovery. |
| `RecordTraceMeta` | interface | Metadata for {@link IntelligenceClient.recordTrace}. |
| `RepoConfig` | interface | Repo coordinates a product may declare for the (later) Gated-PR mode. The |
| `RunRecord` | interface | The typed record `withIntelligence` sends per call — serialized through the |
| `RunReport` | interface | What an agent reports (via `applied.record`) to enrich the {@link RunRecord} |
| `SubmitAgentImprovementProposalOptions` | interface | Submit a completed measured proposal for product-side review. |
| `TraceHandle` | interface | The trace handle a `traceRun` body records into. `recordOutput` captures the |
| `TraceMeta` | interface | Metadata describing one traced run. `runId`/`traceId` default to fresh ids. |
| `TraceOutcome` | interface | The resolved outcome of one traced run, surfaced on the export span and |
| `UsageSplit` | interface | The per-class cost split carried by every trace and outcome. `off` ⇒ |
| `AgentCandidateExecutionHostPorts` | type | Product-owned candidate ports other than protected model access. |
| `AgentImprovementActivationReconciliation` | type | Target-read-only check for a prior exact write. |
| `AgentImprovementActivationTransition` | type | Product-owned or Runtime-composed transition. |
| `AgentImprovementExperimentMaterial` | type | Product-supplied experiment material. Runtime supplies optimizer ancestry and the final digest. |
| `AgentImprovementProposal` | type | A Runtime proposal backed by an exact candidate-bundle experiment. |
| `AgentImprovementProposalSubmissionState` | type | What Runtime knows about a failed proposal submission. |
| `CorpusAccess` | type | Corpus access an intelligence tier permits. `'off'` reads and writes |
| `EffortOverrides` | type | Per-field overrides applied on top of a tier preset. Any subset of the |
| `EffortTier` | type | The named effort tiers, lowest to highest. `'off'` is the honest floor |
| `IntelligenceAgent` | type | An agent wrapped by {@link withIntelligence}: receives the input plus the |
| `IntelligenceTelemetryExportOptions` | type | Queue, retry, deadline, and drop controls for Intelligence trace export. |
| `IntelligenceWrapped` | type | The wrapped agent — same `(input) => Promise<output>` shape, plus a manual |
| `PullCertifiedContextOutcome` | type | Typed outcome for the pull. Inspect `succeeded` before reading `value`. |
| `Redactor` | type | A redactor maps an arbitrary trace value to a safe-to-export value. Pure; |
| `SubmitAgentImprovementProposalOutcome` | type | Typed result for proposal submission. A successful result contains the |
| `UsageClass` | type | Usage class for billing. Base-stream tokens bill `'inference'`; every |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentCandidateExperimentCellPlacement`, `AgentImprovementActivationResultStore`, `AgentImprovementActivationTargetPlan`, `AgentImprovementActivationTransitionInput`, `AgentImprovementProfileReplacement`, `AgentImprovementTargetProfileDiffOptions`, `CertifiedContextCheckpointKey`, `CertifiedContextEntry`, `CertifiedContextProvenance`, `ComposedCertifiedContext`, `CreateAgentImprovementActivationOptions`, `CreateAgentImprovementActivationResultOptions`, `CreateAgentImprovementProposalOptions`, `CreateExactProcessCandidateExperimentExecutorOptions`, `ExactProcessCandidateExperimentExecution`, `ExactProcessCandidateExperimentExecutor`, `ExecuteAgentCandidateExperimentCellOptions`, `ExecuteAgentImprovementActivationInput`, `ExecuteAgentImprovementActivationOptions`, `IntelligenceEndpointPolicy`, `OptimizationActivationReceipt`, `OptimizationReceiptCost`, `OtelDropEvent`, `ProposeAgentImprovementOptions`, `ProposeAgentImprovementResult`, `PullCertifiedContextOptions`, `ReviewAgentImprovementInput`, `RunAgentCandidateExperimentOptions`, `RunAgentCandidateExperimentResult`, `VerifyCandidateExecutionEvidenceOptions`, `AgentImprovementActivationIntent`, `AgentImprovementActivationOutcome`, `AgentImprovementActivationTargetIdentity`, `AgentImprovementProfileActivationPreparation`, `AgentImprovementProfileActivationTarget`, `AgentImprovementProfileSurface`, `AgentImprovementProfileTargetState`, `AgentImprovementProfileTargetTransition`, `AgentImprovementReviewDecision`, `CertifiedContextDelivery`, `CertifiedContextKind`, `IntelligenceFlushResult`.

### Loop execution and supervision

Import from `@tangle-network/agent-runtime/loops` — 479 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `allOf` | function | Stop only when EVERY rule stops — for a conservative gate that needs corroboration. |
| `allWorkersStalled` | function | "Everyone is stuck." Fires when every live worker reads `stalled` — no metered activity for |
| `analyzeTrace` | function | Collect the source's spans and run the agent-eval batch analyzers over them under one `runId`. |
| `anyOf` | function | Stop when ANY rule stops — the ordinary composition (each rule is a separate reason to end). |
| `anytimeReport` | function | Derive anytime metrics from waterfall spans. `targets` are the satisficing score |
| `areaUnderCurve` | function | Mean of a best-so-far curve — the anytime AUC when the curve is normalized to [0,1]. Higher = |
| `asAuthoredProfile` | function | Narrow an untyped `spawn_agent` profile argument to an `AuthoredProfile`, or null if the |
| `assertModelAllowed` | function | Throw a `ConfigError` when `allowed` is set, `model` is defined, and `model` is not a |
| `assertSteerableEnvironmentProvider` | function | Assert that supervision received a provider capable of creating environments. |
| `assertStrategyContract` | function | Static CONTRACT lint over an authored strategy module — the module-boundary |
| `assessAuthoredProfile` | function | OBSERVE one authored `AgentProfile` and score its richness (no judge verdict is read). The task |
| `auditIntent` | function | The route-rigor analyst: compare declared vs revealed vs user intent over a trajectory and return aligned / drifting / diverged with evidence and one recommended intervention. |
| `authoredWorker` | function | Build a worker AGENT from a profile the supervisor authored: the authored `systemPrompt` + |
| `authorStrategy` | function | Author + load a strategy from losses. Throws when the author emits no loadable module; |
| `bestSoFar` | function | The best-so-far fold — the ONE definition of "how good was the run after k results", shared by |
| `breadthStrategy` | function | BREADTH: K independent rollouts (each own artifact), verifier picks the best. |
| `buildSteerContext` | function | Build the `SteerContext` a combinator reads to steer (its `loopUntil.until`, `widen` gate, any |
| `canDisplace` | function | The repair keep-best guard: a challenger displaces the incumbent only when it is |
| `collectAgentTurn` | function | Drain a `streamAgentTurn` stream (or any `RuntimeStreamEvent` stream that |
| `compareCheckOutcomes` | function | The selection order: crash < ran; then official pass-fraction; authored guesses only |
| `completionAuthorizes` | function | Decide whether a `CompletionVerdict` may end the node under the policy: authority scales with the verdict's determinism, and probabilistic verdicts must clear `minConfidence`. |
| `composeCheckSources` | function | Concatenate check sources (official first by convention — ordering does not affect |
| `computeFindingId` | function | Compute the stable finding_id from the identity-defining fields. |
| `connectStdioMcp` | function | Spawn a trusted host command, complete the stdio MCP handshake, and return |
| `contentAddress` | function | Mint the content-addressed `outRef` for a result artifact: `sha256:<hex>` over a |
| `createActivityLog` | function | Create a bounded activity ring. `limit` caps memory for a worker that runs thousands of tools. |
| `createAgentEnvironmentProviderRegistry` | function | Create a named registry for agent environment providers. |
| `createBudgetPool` | function | Create a conserved reservation pool from a root `Budget`. `now()` is injected so the |
| `createEnvironmentForSpec` | function | Create and prepare one provider-neutral agent environment. |
| `createEnvironmentLineage` | function | Create, fork, resume, and prune related agent environments. |
| `createEnvironmentToolPartState` | function | Fresh per-turn {@link EnvironmentToolPartState} for {@link mapEnvironmentToolEvent} — an |
| `createEventBus` | function | Create the child→parent coordination bus: one typed pipe for settled outputs, questions, and analyst findings, with a priority-ordered pull queue and a pass-through subscribe lane. |
| `createFileRunContext` | function | Build a DURABLE run context: the spawn journal and the result blobs are file-backed (fsynced |
| `createInbox` | function | Create the worker-side inbox for the down-leg: the driver's `steer_agent` / `answer_question` messages queue here and the worker's loop drains them at step boundaries and before settle. |
| `createInMemoryRunContext` | function | Build a fresh in-memory run context. Every call returns NEW stores (no shared global |
| `createMcpEnvironment` | function | Wrap any MCP server as an `Environment`: `tools/list` becomes `EnvironmentTool[]` with provider-safe schemas; the domain supplies only the artifact lifecycle hooks. |
| `createProgressTracker` | function | Build the settled-work ledger a `StopRule` decides from: record each settlement (idempotent by |
| `createPushTraceSource` | function | A push source for OWNED tool loops (router-tools / cli-bridge tool dispatch): the loop calls |
| `createScope` | function | Create the reactive `Scope` a driver's `Agent.act` runs inside: spawn children on an atomically reserved conserved budget, settle via the `next()` cursor, journal for replay. |
| `createScopeAnalyst` | function | Build a `ScopeAnalyst` that spawns the analyst agent through `Scope.spawn` (so its compute is |
| `createSteerableEnvironmentSession` | function | One steerable environment worker. The session starts when `stream()` is drained. |
| `createSupervisor` | function | The `Supervisor` impl (KEYSTONE, build step 5). |
| `createVerifierEnvironment` | function | Any checkable task as an `Environment`, no tool surface required: the artifact is the worker's answer and the domain is one deployable `check` over it. |
| `createWaitProbes` | function | Registry over a plain name→predicate record. |
| `createWaterfallCollector` | function | Build a `WaterfallCollector` that records agent spans and renders them as an ASCII timeline. |
| `createWorktreeCliExecutor` | function | Build a worktree-CLI leaf `Executor`. Per-spawn (a fresh worktree + abort + teardown each), so a |
| `decodeToolPart` | function | Decode a part with a specific harness's adapter when known, else try every registered adapter |
| `defaultExtractCandidate` | function | The candidate a shot produced, read from its conversation: the LAST `submit_answer` |
| `defaultSelectWinner` | function | The kernel's winner argmax — best-valid-score, ties broken by earliest index, |
| `defaultToolDetectors` | function | The default online panel for a tool-call pipe: a worker repeating the same call, or hammering |
| `defineLeaderboard` | function | Assemble a declarative spec (`cases` + `prompt` + `score`) into a runnable |
| `defineStrategy` | function | Author a Strategy from the composable steps — the open, compact way. |
| `delegate` | function | Delegate an INTENT to a default authoring supervisor and return its `SupervisedResult` unchanged. |
| `depthStrategy` | function | DEPTH: one persistent artifact, carried across analyst-steered shots. |
| `deterministicCompletion` | function | Completion for a DETERMINISTIC check (build/test/lint/citation/proof): done iff the check |
| `discriminatingMeans` | function | Strategy means recomputed over the DISCRIMINATING tasks only — tasks where the field |
| `driverAgent` | function | Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a |
| `dumbDriver` | function | `dumbDriver` — the pass/fail-only steering control. |
| `effectiveConcurrency` | function | The ONE honest effective limit on simultaneous workers: the minimum of the caps that actually |
| `envKeyProvider` | function | The env-backed provider: reads the (dotenvx-loaded) process env. Empty / |
| `equalKOnCost` | function | Assert the arms are comparable at EQUAL conserved COST (tokens + usd), NOT raw iteration |
| `extractEnvironmentFinalText` | function | Read final text from a terminal provider event when the provider reports it. |
| `extractEnvironmentTurnText` | function | Resolve one provider turn to text, preferring its terminal result over deltas. |
| `extractLlmCallEvent` | function | Extract a `RuntimeStreamEvent`-shaped `llm_call` from a provider event when |
| `failuresAnalyst` | function | The default self-improvement LENS — authored content, not a code path. On each settled worker it hands |
| `filterAuthoredAsserts` | function | The proven authored-assert filter (lifted from the rigs' generateTests): keep only |
| `finalizeBestDelivered` | function | Keep-best finalize under the completion-oracle: return the highest-scoring DELIVERED child's |
| `freeSlots` | function | Free worker slots under a simultaneity cap: `cap - live`, floored at 0, or `null` when there is |
| `gateOnDeliverable` | function | Wrap an `Executor` so its settlement `valid` reflects the deliverable check, not the |
| `gitWorkspace` | function | A `Workspace` over a git checkout: materialize an isolated worktree at `ref`, commit produced changes (conflict-aware), and read `head` — hooks disabled, identity pinned. |
| `harvestCorpus` | function | Batch the firewalled `observe()` analyst over completed runs and accrete the trace-derived facts into the durable corpus — the production-traces→corpus write side of the flywheel. |
| `inlineEnvironmentProvider` | function | Adapt an executor factory into an environment provider. |
| `inProcessEnvironmentProvider` | function | Create a deterministic provider backed by one callback. |
| `isWaitOutcome` | function | Narrow a settlement's `out` to a wait outcome — a wait settles on the SAME cursor as workers, |
| `jjWorkspace` | function | A jj-backed `Workspace` (Jujutsu, colocated with git for the durable remote). |
| `leaderboard` | function | Aggregate a fleet of records into the ranked, multi-axis report. Pure — no IO, deterministic. |
| `localEnvironmentProvider` | function | Run trusted stdio MCP tools and a router model on the current host. |
| `localShell` | function | Host-process `Shell`: run a command via `execFile`, resolving `{ stdout, stderr, code }` (never throws on non-zero exit). |
| `loopCampaignDispatch` | function | Adapter for plain `runCampaign` scenarios. This is the runtime-side pair for |
| `loopDispatch` | function | Adapter for `runProfileMatrix` (profile is an axis). Returns a |
| `makeFinding` | function | Convenience factory: produce a fully-formed AnalystFinding with the |
| `mapAgentEnvironmentEvent` | function | Project one `AgentEnvironmentEvent` onto the `RuntimeStreamEvent` chat-UX vocabulary, |
| `mapEnvironmentToolEvent` | function | Project one `AgentEnvironmentEvent` onto the `tool_call` / `tool_result` variants of |
| `materializeLocalMcp` | function | Spawn every explicitly trusted stdio server in `profile.mcp` as a same-host |
| `materializeTreeView` | function | Materialize a recorded `TreeView` from a journaled event list for inspection. Folds |
| `modelAuthoredChecks` | function | Default authored-check source: one metered LLM call per task, before sampling, |
| `naiveDriver` | function | `naiveDriver` — the no-signal steering control. |
| `noProgressFor` | function | "Nothing new has happened." Fires when the run has produced no new settled work for `ms`, or no |
| `notifyAgentEnvironmentEventObserver` | function | Forward a provider event to an optional observer without letting observer |
| `observe` | function | The third-person trace analyst: read a worker's trace and produce steer findings for the next attempt plus durable `learned` facts for the cross-run corpus. |
| `officialChecksFromMeta` | function | Official checks the surface stashed on the task (e.g. MBPP's shown assert). Reads |
| `openEnvironmentRun` | function | Open one persistent environment, run its first turn, and resume the same |
| `pairwiseSignificance` | function | Compare EVERY profile pair on the scenarios they both ran — paired-bootstrap effect + CI, a real |
| `patchDelivered` | function | Build the `DeliverableSpec<WorktreePatchArtifact>`: `check(artifact)` runs the shared mechanical |
| `pendingWaits` | function | The waits a journaled tree shows as ARMED but never woken — what a resumed run re-arms with the |
| `pickChampion` | function | The champion pick over a means table. 'score' takes the best mean score (ties → |
| `plateau` | function | "The objective has stopped climbing." Fires when the best-so-far curve has risen by no more than |
| `plateauLength` | function | How many trailing entries of a best-so-far curve are within `minDelta` of the curve's value |
| `pollFor` | function | Build a bounded `poll` spec from a duration. |
| `printBenchmarkReport` | function | Pretty-print a report — the "free optimization" verdict, with the cost vector. |
| `profileRichnessFinding` | function | Turn a {@link ProfileRichness} verdict into a bus-routable `AnalystFinding` (area `profile-quality`). |
| `promotionGate` | function | Statistical promotion decision over a holdout benchmark: a seeded paired bootstrap (`heldoutSignificance`) whose CI lower bound must clear `deltaThreshold`. |
| `queueOf` | function | Convenience: a `DispatchUnit` factory over a fixed array of tasks, for the common case where |
| `readWorkerProgress` | function | Fold the scope-derived facts and the executor's optional enrichment into one read. Pure: the |
| `registryScopeAnalyst` | function | A `ScopeAnalyst` backed by an `AnalystRegistry` — the panel-of-analysts seam. The registry merges |
| `renderAnytimeTable` | function | One row per (strategy, satisficing target): the shareable time-to-satisfactory table. |
| `renderCorpusToInstructions` | function | Queries the corpus through `filter`, renders the matching facts |
| `renderLeaderboardHtml` | function | Render a self-contained HTML leaderboard page (the hosted surface): the SVG charts + the full Markdown |
| `renderLeaderboardMarkdown` | function | Render the report as a publishable Markdown document: provenance → leaderboard → the full profile×axis |
| `renderLeaderboardSvg` | function | Render a self-contained SVG: a ranked score bar chart on top, the profile×axis heatmap below. No deps, |
| `renderPairwiseMarkdown` | function | Render the pairwise-significance table — every profile pair's paired delta, CI, and BH-corrected |
| `renderReport` | function | Operator-facing report, split by who should act. The agent block is the |
| `replaySpawnTree` | function | Re-feed a journaled spawn tree in strict `seq` order, rehydrating each settled |
| `reportLoopUsage` | function | Forward a `LoopResult`'s aggregated cost + token usage into a campaign cost |
| `resolveAgentEnvironmentProvider` | function | Resolve an inline provider or a provider name from a registry. |
| `resolveEntrySymbol` | function | The symbol authored checks are pinned to: `task.meta.entryPoint` when the surface |
| `resolveSecretEnv` | function | Resolve a declared secret-env map into the real env entries for a server |
| `rollingDispatch` | function | Run the refilling dispatch loop over `scope` until the queue is dry (or a stop fires) and every |
| `routerBrain` | function | The router as a supervisor BRAIN: the canonical `ToolLoopChat` seam backed by the router's |
| `routerChatWithTools` | function | A router completion WITH tool-calling — the operator driver's LLM seam. Passes OpenAI-shape |
| `routerChatWithUsage` | function | One OpenAI-compatible chat completion through the Tangle router, returning text + REAL token usage (`undefined` when the provider omits it — never a fabricated 0). |
| `routerEnvironmentProvider` | function | Run profiles through an OpenAI-compatible router on the current process. |
| `routerToolLoop` | function | The tool-using router backend: a real agentic loop OVER the Tangle router (which |
| `runAgentRounds` | function | The round-synchronous MULTI-AGENT kernel: each round `driver.plan()` fans N tasks |
| `runBenchmark` | function | Run the requested strategies over the tasks, scored by the Environment's own check. |
| `runInWorkspace` | function | Run a worker `body` inside a FRESH clone of a shared `Workspace`, then commit its work back |
| `runStrategy` | function | Run a Strategy through the keystone Supervisor — `Agent.act` over a conserved-budget Scope. |
| `runStrategyEvolution` | function | Multi-generation strategy search: author candidates from tournament losses, play them against the incumbent at equal budget, promote via `promotionGate` on an untouched holdout slice. |
| `sampleFromSettled` | function | Build a `ProgressSample` from a scope settlement. The objective is the verdict score and |
| `sandboxCheckRunner` | function | Default CheckRunner backend: pipes the check program into `python3` over the sandbox |
| `sandboxSessionTraceSource` | function | The SANDBOX / fleet trace source: read a box session's message parts and decode the harness's tool |
| `sanitizeMcpToolSchema` | function | Coerce an MCP inputSchema to an OpenAI-tool-valid top-level object schema. |
| `secretEnvOfMcpServer` | function | Read (and validate) a server entry's declared secret-env map, if any. |
| `selectBestIndex` | function | Argmax by `compareCheckOutcomes`, FIRST index wins ties (deterministic; with zero |
| `selectChampion` | function | Search-side champion selection over a tournament report. |
| `sentinelCompletion` | function | Completion for a sandbox-agent node: done iff the latest output carries the node's stop |
| `serveCoordinationMcp` | function | Stand up the coordination MCP over a live scope. The HOST address is `127.0.0.1` (the bridge runs |
| `settledToIteration` | function | The step-8 merge-boundary adapter (M4): rehydrate a `Settled.done` into the kernel's |
| `spendFromUsageEvents` | function | Fold a normalized `UsageEvent` array into a `Spend`. Tokens and usd are separate |
| `stopSentinel` | function | A unique, attributable stop sentinel for a node (ralph-loop style). Deterministic from the |
| `streamAgentTurn` | function | Run one agent turn and stream its events. Yields the |
| `structuralRollout` | function | Build the structuralRollout `Strategy`: k shots → score each by the frozen visible |
| `sumEnvironmentUsage` | function | Sum the token usage + USD cost of a provider turn's events — the one honest way to meter an |
| `supervise` | function | One-call supervisor: build + run a supervisor from its profile with sensible defaults; the raw `supervisorAgent` + `createSupervisor().run` seams stay available for power use. |
| `superviseSurface` | function | Drive a team of agents (spawned + steered by `profile`) to solve a graded `TaskEnvironment` task, and |
| `supervisorAgent` | function | Build a supervisor `Agent` from its profile. |
| `supervisorInstructions` | function | The supervisor SKILL — the how-to the supervisor reads (its system prompt). THE optimizable |
| `timerAt` | function | Build a `timer` spec from a DURATION. The instant is resolved once, at arm time — a resumed |
| `trajectoryReport` | function | Reconstruct the whole spawn tree for `root` with per-node + rolled-up `Spend`. Reads the |
| `turnEvents` | function | Stream one environment turn through SSE or polling. |
| `validateWaitSpec` | function | Structural validation, independent of the run. Returns null when the spec is usable. |
| `visibleCheckScore` | function | Display scalar for receipts/reports (the rigs' `visibleScore` shape): crash = -1, |
| `waitUntil` | function | The absolute instant a spec is bounded by, or `undefined` for an unbounded poll. |
| `watchTrace` | function | Subscribe to a `TraceSource` and run the streaming detectors over its live spans. Returns an |
| `workerFromEnvironment` | function | Build workers from the environment provider used for each spawned profile. |
| `workerFromExecutor` | function | Build workers from a custom executor factory. |
| `adaptiveRefine` | const | A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot |
| `assertTraceDerivedFindings` | const | Analyst-on-scope (G1) — the analyze→findings→steer wire over the reactive `Scope`. |
| `DEFAULT_ENVIRONMENT_STEERING_MAX_TURNS` | const | Steerable provider worker: one environment, one server-side session, many turns. |
| `DEFAULT_STALL_AFTER_MS` | const | How long a worker may produce no metered activity before a `progress()` read calls it stalled. |
| `defaultAnalystInstruction` | const | The default observer instruction — exported so an optimizer can seed its population. |
| `defaultAuditorInstruction` | const | Default system instruction for intent-auditor agents: diagnose diverged/drifting trajectories. |
| `defaultDelegateBudget` | const | The conserved pool a `delegate()` call applies when the caller does not pass its own `budget`. |
| `defaultProfileRichnessThresholds` | const | Default thresholds for `ProfileRichnessThresholds` — 600 chars / 6 lines minimum system prompt. |
| `defaultStructuralRolloutPolicy` | const | The measured default recipe: 5 samples, 2 guarded repair rounds, 6 authored checks. |
| `mcpSecretEnvMetadataKey` | const | The `AgentProfileMcpServer.metadata` key the declarative secret-env map |
| `PI_RUNTIME` | const | The runtime name `piExecutor` registers under. |
| `piExecutor` | const | Build the `Executor` for one pi worker. Registered as runtime `'pi'`. |
| `piSeamKey` | const | Seam key the registry threads a `PiSeam` through (`ExecutorContext.seams['pi']`). |
| `refine` | const | Built-in `Strategy`: attempt → `observe()` reads the trace → steer the next attempt → repeat (deepen one lineage). |
| `sample` | const | Built-in `Strategy`: K independent attempts, keep the best-verifying (best-of-N / resample). |
| `sampleThenRefine` | const | The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open), |
| `strategyAuthorContract` | const | The compressed consumable a skill carries: everything an author needs to emit a loop. |
| `EnvironmentRunAbortError` | class | Abort error that retains events observed before cancellation. |
| `FileCorpus` | class | JSONL on disk — one validated `CorpusRecord` per line, append-only. `query` replays the whole |
| `FileResultBlobStore` | class | FS `ResultBlobStore`. One JSON file per artifact under `dir`, named by a |
| `FileSpawnJournal` | class | JSONL on disk. One line per record: the first record is `begin`, subsequent records |
| `InMemoryCorpus` | class | In-memory `Corpus`. Keyed by record `id`; `append` validates the record, is idempotent on an |
| `InMemoryResultBlobStore` | class | In-memory `ResultBlobStore`. Content-addressed: `put` verifies the supplied |
| `InMemorySpawnJournal` | class | In-memory `SpawnJournal`. Appends are observed-committed only; the impl enforces |
| `McpSpawnFault` | class | A missing start binary / spawn fault: a SETUP bug, never a failed candidate. |
| `ActivityLog` | interface | A bounded newest-last ring of `ActivityNote`s an executor keeps to answer `progress()`. |
| `ActivityNote` | interface | The most recent activity the executor can name — one tool call, one turn, or a free-form note. |
| `Agent` | interface | One self-similar atom. A leaf is an `Agent` that never calls `scope.spawn`; a driver |
| `AgentEnvironmentProviderRegistry` | interface | Named provider registry for runtime composition and configuration. |
| `AgentRunSpec` | interface | Provider-neutral agent run specification. |
| `AgentSpec` | interface | `AgentProfile` does NOT carry a `harness`/backend field — `harness` lives on the |
| `AgentTurnUsage` | interface | Metered usage of one turn, summed over every cost-bearing provider event. |
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
| `CheckRunner` | interface | Executes the frozen checks against one candidate. Implementations MUST fail loud |
| `CheckSource` | interface | Produces the task's visible checks. MUST derive them from agent-visible information |
| `CheckSourceCtx` | interface | What a CheckSource composes with. `consult` is the strategy family's raw analyst |
| `CollectedAgentTurn` | interface | A drained turn: the terminal summary plus every event the stream yielded. |
| `CompletionAnalyst` | interface | Reads a node's trace → a completion verdict. Same input shape as the `analyze` hook, so |
| `CompletionEvidence` | interface | Trace-derived evidence for a completion claim — an artifact (output) or a verifier metric, |
| `CompletionPolicy` | interface | When a verdict authorizes the driver to END. Deterministic → trust (ground truth); |
| `CompletionVerdict` | interface | The "is it done?" verdict an analyst returns to the parent. |
| `ConcurrencyCaps` | interface | The caps a host can set on simultaneous work. See the ledger in this module's header for what |
| `CoordinationMcpHandle` | interface | Serve the coordination verbs (spawn_agent / await_event / observe_agent / steer_agent / stop) |
| `Corpus` | interface | The durable cross-run corpus. Distinct from `SpawnJournal` |
| `CorpusFilter` | interface | A corpus query filter — every field is an AND-narrowing; an omitted field does not constrain. |
| `CorpusRecord` | interface | One retained fact in the cross-run corpus. Distinct from |
| `CreateScopeAnalystOptions` | interface | The analyst run an `Agent<unknown, AnalystFinding[]>` performs over the children settled so far. |
| `DefaultVerdict` | interface | Minimal verdict shape — `valid` + `score` are required; `scores` + |
| `DelegateOptions` | interface | Inputs to {@link delegate}. |
| `DeliverableSpec` | interface | The deployable completion oracle passed to {@link gateOnDeliverable}: a `check` that |
| `DispatchUnit` | interface | One unit of queued work: the agent to run, its task, and the spawn options (budget + label). |
| `DriverAgentOptions` | interface | `driverAgent` — the driver's BRAIN. |
| `DumbDriverOptions` | interface | Options for {@link dumbDriver}. |
| `EnvironmentRun` | interface | A persistent agent environment and its resumable session. |
| `EnvironmentTask` | interface | Execute sequential or parallel strategies over a scored task environment. |
| `EnvironmentToolPartState` | interface | Cross-event state for {@link mapEnvironmentToolEvent}. Providers emit a |
| `EnvironmentTurnResult` | interface | Result of one turn in a persistent environment. |
| `EnvironmentWorkerOptions` | interface | Provider-backed worker configuration used by supervision and delegation. |
| `EnvironmentWorkerResult` | interface | Output returned by a provider-backed supervised worker. |
| `EqualKArm` | interface | One arm of an equal-k comparison — a labeled trajectory (a `TrajectoryReport` is one arm's whole |
| `EqualKOnCostOptions` | interface | `equalKOnCost(arms, { tolerance? })` — assert arms are comparable at EQUAL conserved COST |
| `EqualKVerdict` | interface | The equal-k-on-cost verdict: whether every arm spent within `tolerance` of the others on the |
| `EvolutionAuthor` | interface | runStrategyEvolution — the multi-generation strategy search: per generation the system |
| `ExecCtx` | interface | Execution context for `runAgentRounds`. |
| `Executor` | interface | The leaf runtime — ONE open interface, not a closed union. `execute` returns a |
| `ExecutorContext` | interface | Construction context handed to a `ExecutorFactory` — the seams a built-in needs |
| `ExecutorProgress` | interface | What an executor OPTIONALLY adds to the scope-derived progress (`Executor.progress()`). Every |
| `ExecutorRegistry` | interface | The OPEN resolver: maps an `AgentSpec` to a `ExecutorFactory`. The default |
| `ExecutorResult` | interface | Terminal artifact of a one-shot `Executor.execute`. |
| `HarvestCorpusOptions` | interface | harvestCorpus — production traces → corpus, the G2 bridge (the playbook's step 6). |
| `InboxMessage` | interface | The worker-side receive end of the down-leg: a per-worker inbox an executor exposes as |
| `InMemoryRunContext` | interface | The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`. |
| `InMemoryRunContextOptions` | interface | Options for a supervised run context. |
| `InProcessTurnContext` | interface | Context passed to an in-process turn callback. |
| `Interval` | interface | A 95%-by-default confidence interval. |
| `KeyProvider` | interface | Resolve named secrets. The ONE seam every secret store adapts to. |
| `LeaderboardBenchmarkAdapter` | interface | Structurally `BenchmarkAdapter` (bench registry shape): `name`, |
| `LeaderboardBenchScore` | interface | Structurally `BenchScore` (bench registry shape). |
| `LeaderboardBenchTask` | interface | Structurally `BenchTask` (bench registry shape) — declared locally so this |
| `LeaderboardFlagSpec` | interface | One extra CLI flag a spec declares. Parsed by `run()` as `--<name> <value>` |
| `LeaderboardIterationInfo` | interface | Per-shot outcome context passed as `onCellEvents`'s third argument — how a |
| `LeaderboardRow` | interface | One leaderboard row for one canonical profile and one data split. |
| `LeaderboardRunContext` | interface | Resolved run configuration handed to `setup` / `teardown` / `export`. |
| `LeaderboardScenario` | interface | The campaign scenario a case is wrapped into: the case rides along so |
| `LeaderboardScore` | interface | Structured per-case verdict a `score` function may return (a bare number is |
| `LeaderboardSpec` | interface | The declarative leaderboard spec. `TArtifact` is the artifact channel the |
| `LocalMcpMaterialization` | interface | The live same-host materialization of a profile's `mcp` surface. |
| `LoopCampaignDispatchOptions` | interface | Options for adapting plain agent-eval campaign scenarios into runtime `runAgentRounds` cells. |
| `LoopIterationDispatchPayload` | interface | Where the iteration's worker was placed. `sibling` means a fresh isolated |
| `LoopLineageOptions` | interface | Opt-in box-lineage controls for `runAgentRounds`. Default OFF — with both flags |
| `LoopPlanPayload` | interface | Emitted once per `plan()` round, immediately after the driver plans. Carries |
| `LoopTeardownFailedPayload` | interface | Emitted when a box's `delete()` throws or times out during teardown — the |
| `LoopTokenUsage` | interface | LLM token usage. Structurally maps into agent-eval's paid-call receipt so a |
| `McpEndpoint` | interface | Where a handle's MCP server lives; headers carry per-artifact scoping. |
| `MountManifestEntry` | interface | One mounted resource recorded during box preparation — a pure provenance |
| `NaiveDriverOptions` | interface | Options for {@link naiveDriver}. |
| `ObserveInput` | interface | The third-person observer — the connective tissue that closes the loop. |
| `OutputAdapter` | interface | Stream of provider-neutral environment events to typed output. |
| `PairwiseVerdict` | interface | One profile pair compared on the scenarios they BOTH ran — the "who actually beat whom" verdict. |
| `PendingWait` | interface | A wait recorded in the journal that never woke — what a resumed run re-arms. |
| `PiSeam` | interface | How to launch pi in its out-of-process RPC mode, and how long to wait on it. |
| `ProfileRichness` | interface | Per-field verdict on one authored profile — the raw material the bench renders + scores. |
| `ProfileRichnessThresholds` | interface | Thresholds below which a system prompt is treated as a thin stub. Tunable per call. |
| `ProgressSample` | interface | One settled unit of work, reduced to what a stop rule reads. `objective` is the run's own |
| `ProgressTracker` | interface | Accumulates settlements and materializes a `ProgressView`. Idempotent by settlement id, so a |
| `ProgressView` | interface | The read-model a `StopRule` decides from — the run's progress, not its budget. |
| `RegistryAnalyzeProjection` | interface | Project a `ScopeAnalyzeInput` into the `AnalystRegistry.run` arguments. The registry runs over a |
| `RenderCorpusToInstructionsOptions` | interface | Project retained corpus facts into an `AgentProfile`. |
| `ReservationTicket` | interface | Opaque, single-use reservation handle returned by `reserve` and consumed by |
| `ResultBlobStore` | interface | Content-addressed result blobs (the `outRef` → artifact map) backing the replay |
| `ResumedWork` | interface | The committed work a resumed run inherits from its journal. `settled` is the replayed |
| `RouterConfig` | interface | The one router chat client: direct OpenAI-compatible completions through the |
| `RouterToolCall` | interface | A tool-call the model emitted (provider-neutral; mirrors the runtime's ToolCallRequest). |
| `RunProvenance` | interface | Domain-free run provenance: a manifest of what was mounted into the run's |
| `Scope` | interface | The budget-conserving reactive scope an `Agent.act` runs inside. `spawn` reserves |
| `ScopeAnalyst` | interface | The reactive analyst seam — the PORT of the round-synchronous driver's `analyze` hook |
| `ScopeAnalyzeInput` | interface | Input to a `ScopeAnalyst.analyze` — the root task framing + the children settled so far. |
| `ScopeProgressInput` | interface | The scope-side facts about a child, independent of whether its executor cooperates. |
| `SelectionReceipt` | interface | A record of one candidate-selection decision: which iteration the selector |
| `SessionTraceBox` | interface | The minimal box surface this needs: list a session's messages (incl. mid-turn partials). |
| `ShotPersona` | interface | A role for one shot — multi-agent loops (researcher + engineer, a panel of k |
| `SpawnJournal` | interface | The spawn-tree event source (mirrors `ConversationJournal`'s begin/append/load shape). |
| `Spend` | interface | Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd |
| `StdioMcpServerSpec` | interface | Same-host stdio MCP: the ONE persistent newline-delimited JSON-RPC 2.0 |
| `SteerContext` | interface | How a combinator's `act` consumes findings to steer — the SINGLE firewalled steer surface a |
| `StrategyCtx` | interface | What a strategy body composes with: the artifact lifecycle, the budget, and the two steps. |
| `StructuralRolloutPolicy` | interface | The rollout's compute recipe — promoted from the proven rigs' env vars (K/REPAIRS/ |
| `StructuralRolloutResult` | interface | The body's deliverable — a `StrategyResult` plus selection provenance. The extra |
| `SuperviseSurfaceResult` | interface | The deployable outcome of a supervised surface run. |
| `Supervisor` | interface | Owns the conserved pool, the spawn log, the abort cascade, the OTP intensity breaker, |
| `SupervisorProfile` | interface | The subset of an `AgentProfile` that selects and shapes the supervisor brain. |
| `SurfaceWorkerConfig` | interface | How a worker runs the surface task (its router substrate + per-attempt bounds). |
| `SurfaceWorkerOut` | interface | What a surface worker settles with — the surface verdict the driver + deliverable read. `resolved` is |
| `TaskEnvironment` | interface | A stateful, checkable environment an agent operates over with tools. Open behind one interface. |
| `ToolLoopCompaction` | interface | Self-compaction — bound the loop's OWN context window the way a fresh-respawn (dumb-Ralph) loop |
| `TrajectoryAnalysis` | interface | The SETTLE-time analyst: when a worker finishes, collect its tool spans from a `TraceSource` and run |
| `TrajectoryNode` | interface | One node in the reconstructed trajectory tree — a driver OR a leaf, with its OWN spend and the |
| `TrajectoryReport` | interface | The whole reconstructed trajectory — the realized tree + its root-rolled-up total. The |
| `TrajectoryReportOptions` | interface | `trajectoryReport(journal, blobs, root, { withOutputs? })` — reconstruct the whole tree with |
| `TreeView` | interface | The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer. |
| `UsageSink` | interface | The slice of an agent-eval campaign `DispatchContext.cost` this needs. |
| `VerifierEnvironmentOptions` | interface | createVerifierEnvironment — ANY checkable task as an `Environment`, no tool surface |
| `VisibleCheck` | interface | One task-visible executable check (e.g. a single-line Python assert). |
| `WaitOutcome` | interface | The `out` a settled wait node delivers through `Scope.next()`. `settled` is the outcome the |
| `WaitProbeRegistry` | interface | Resolves a `poll` spec's `probe` name to its predicate. Threaded through `SupervisorOpts` so |
| `WatchTraceOptions` | interface | The ONLINE analyst: watch a `TraceSource` and fold each tool span through agent-eval's published |
| `WaterfallSpan` | interface | createWaterfallCollector — 100% trajectory observability from the lifecycle stream: |
| `WidenGate` | interface | The progressive-widening gate (MCTS-PW). Decides whether a settled child is |
| `WorkerProgress` | interface | The full live view of one worker, as `observe_agent` returns it mid-flight. |
| `WorktreeCommandResult` | interface | Outcome of one verification command run in the worktree (test or typecheck). |
| `WorktreeProfileMaterializationReceipt` | interface | Proof of the profile inputs delivered before the worker process started. |
| `AgentEnvironmentProviderRef` | type | Provider object or registry name accepted by runtime APIs. |
| `AgentProfileRef` | type | Portable profile reference: inline profile or provider catalog id. |
| `AgentTurnTarget` | type | The execution target for one turn. |
| `ApplyContinuation` | type | Fold a steering string into the caller's Task shape, producing the Task for |
| `AssertTraceDerivedFindings` | type | The firewall assertion contract, re-stated for the reactive seam (PORT of |
| `BudgetReadout` | type | Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`, |
| `CoordinationEvent` | type | Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for |
| `DispatchStopReason` | type | Why the dispatcher stopped admitting work. `drained` = the queue ran dry (the ordinary end); |
| `DriveHarness` | type | How to run a sandboxed harness as the DRIVER, with the coordination verbs mounted — the substrate |
| `Environment` | type | A checkable task domain — implement these 5 hooks and the suite does the rest. The |
| `EnvironmentDeliverable` | type | Convert a completed turn into the caller's typed result. |
| `EqualKOnCost` | type | `equalKOnCost(arms, opts)` — the cross-arm equal-compute check on conserved cost. |
| `ExecutorFactory` | type | Builds a fresh `Executor` for one spawn from the resolved spec. Per-spawn (not |
| `InProcessOnTurn` | type | Produces one environment event stream without network access. |
| `LoopOptionsForDispatch` | type | runAgentRounds options minus the `ctx` (loopDispatch builds the ctx). |
| `MountRecorder` | type | Records a mounted resource into the run's provenance manifest. Passed to |
| `NodeId` | type | Deterministic node id — `${parent}:s${seq}` from the cursor order, never wall-clock. |
| `RenderCorpusToInstructions` | type | `renderCorpusToInstructions(opts)` — the flywheel read-back projection. Async (queries the |
| `RunContext` | type | The stores a supervised run needs, in-memory or file-backed. `InMemoryRunContext` is the |
| `Runtime` | type | The runtime tag of a `Executor` impl. Open by intent: custom runtimes use their own string name. |
| `Settled` | type | A settled child, delivered by `scope.next()`. `seq` is the monotonic cursor order |
| `Shell` | type | Command runner seam. Host code can use `localShell`; sandbox code can wrap `box.exec`. |
| `SpawnEvent` | type | Journaled spawn-tree events (B1/B2). `seq` is the cursor order; `at` is an ISO |
| `SteeringDecision` | type | Terminal-or-continue decision shared by all three steering drivers. The |
| `StopDecision` | type | A stop rule's answer. `reason` is required when stopping — a run that ends must be able to say |
| `StopRule` | type | Evaluated from the progress feed, never from the budget. Pure and synchronous: it is called on |
| `SupervisedResult` | type | Typed terminal result (M2) — a no-winner is NEVER coerced to a best-effort output. |
| `ToolLoopChat` | type | One inference turn over the running conversation + the tool specs → the model's text, any |
| `ToolLoopCompactionOptions` | type | Public supervisor-facing compaction config: same knobs as the primitive, but `distill` is optional |
| `TrajectoryReportFn` | type | `trajectoryReport(...)` — the tree+cost reconstructor. Async (reads journal + optionally blobs). |
| `UsageEvent` | type | Normalized usage event — the single channel every executor reports through, so the |
| `WaitProbe` | type | A named predicate a `poll` node re-checks. Returns true when the condition it watches has |
| `WaitRejection` | type | Reject reasons for `Scope.wait`, mirroring `Scope.spawn`'s fail-closed admission shape. |
| `WaitSpec` | type | What a wait node is waiting for. Both variants carry ABSOLUTE epoch-ms instants so a wait |
| `WorktreePatchArtifact` | type | Terminal artifact of one worktree-CLI run — the canonical worktree-harness result (the captured |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentEnvironment`, `AgentEnvironmentCapabilities`, `AgentEnvironmentEvent`, `AgentEnvironmentProvider`, `AgentEnvironmentQuery`, `AgentEnvironmentSummary`, `AgentSession`, `AgentSessionRef`, `AgentTurnInput`, `AgentTurnResult`, `AllWorkersStalledOptions`, `AnalystRegistry`, `AnytimeReport`, `AnytimeStrategySummary`, `ArtifactHandle`, `AuditIntentOptions`, `AuthoredStrategy`, `AuthorStrategyOptions`, `BenchmarkConfig`, `BenchmarkLift`, `BenchmarkStrategySummary`, `BenchmarkTaskRow`, `BudgetPool`, `BusStats`, `ChampionPick`, `CheckpointRef`, `CheckpointRequest`, `CheckRunContext`, `CorpusReadbackOptions`, `CreateAgentEnvironmentInput`, `DefinedLeaderboard`, `DispatchReport`, `Driver`, `EnvironmentLineage`, `EnvironmentLineageHandle`, `EnvironmentScore`, `EnvironmentSteeringOptions`, `EnvironmentTool`, `EventBus`, `EvolutionArchiveNode`, `EvolutionBandInfo`, `EvolutionCandidate`, `EvolutionGeneration`, `EvolutionReport`, `ExecRequest`, `ExecResult`, `ForkRequest`, `GitWorkspaceOptions`, `HarvestFailure`, `HarvestReport`, `Inbox`, `InlineEnvironmentProviderOptions`, `InProcessEnvironmentProviderOptions`, `IntentAudit`, `Iteration`, `Leaderboard`, `LeaderboardOptions`, `LocalEnvironmentProviderOptions`, `LoopDecisionPayload`, `LoopDispatchOptions`, `LoopEndedPayload`, `LoopIterationEndedPayload`, `LoopIterationStartedPayload`, `LoopPlanDescription`, `LoopResult`, `LoopStartedPayload`, `LoopTraceEmitter`, `LoopWinner`, `MaterializeLocalMcpOptions`, `McpEnvironmentOptions`, `McpToolDescriptor`, `NoProgressForOptions`, `Observation`, `ObserveOptions`, `OpenEnvironmentRunBeforeStartContext`, `OpenEnvironmentRunOptions`, `PairwiseOptions`, `PatchDeliverableOptions`, `PlacementInfo`, `PlateauOptions`, `ProgressTrackerOptions`, `PromotionGateOptions`, `PromotionVerdict`, `PublishOptions`, `ResourceRequest`, `RollingDispatchOptions`, `RouterChatResult`, `RouterChatToolsResult`, `RouterEnvironmentProviderOptions`, `RouterToolLoopResult`, `RunAgentRoundsOptions`, `RunStrategyOptions`, `ShotSpec`, `SpawnOpts`, `StdioMcpConnection`, `SteerableEnvironmentArgs`, `SteerableEnvironmentSession`, `Strategy`, `StrategyEvolutionConfig`, `StrategyResult`, `StrategyRunResult`, `StrategyWorkerOptions`, `StreamAgentTurnOptions`, `StructuralRolloutConfig`, `SuperviseOptions`, `SuperviseSurfaceOptions`, `SupervisorAgentDeps`, `SupervisorOpts`, `ToolSpec`, `TraceSource`, `ValidationCtx`, `Validator`, `WaterfallCollector`, `WaterfallReport`, `Workspace`, `WorkspaceRequest`, `WorkspaceRun`, `WorktreeCliExecutorOptions`, `AgentEnvironmentStatus`, `AgentSessionStatus`, `ChampionPolicy`, `EnvironmentTurnOptions`, `InProcessTurnEvents`, `LoopTraceEvent`, `MakeWorkerAgent`, `RepairStop`, `WorkspaceCommit`.

### Agent environment provider adapters

Import from `@tangle-network/agent-runtime/environment-provider` — 37 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `createAgentEnvironmentProviderRegistry` | function | Create a named registry for agent environment providers. |
| `resolveAgentEnvironmentProvider` | function | Resolve an inline provider or a provider name from a registry. |
| `AgentEnvironmentProviderRegistry` | interface | Named provider registry for runtime composition and configuration. |
| `AgentExactProcess` | interface | Recoverable handle for one shell-free process. |
| `AgentExactProcessEnvironment` | interface | Fresh environment with no provider-managed user workload. |
| `AgentExactProcessLaunch` | interface | Shell-free launch whose environment replaces, rather than extends, ambient variables. |
| `AgentExactProcessProvider` | interface | Optional all-or-nothing exact process capability of an environment provider. |
| `AgentExactProcessResources` | interface | Explicit portable limits for an exact process environment. |
| `AgentExactProcessStatus` | interface | Terminal or running state reported by an exact process host. |
| `CreateAgentExactProcessEnvironmentInput` | interface | Input for a fresh environment with no provider-managed agent process. |
| `AgentEnvironmentProviderRef` | type | Provider object or registry name accepted by runtime APIs. |
| `AgentExactProcessEgressPolicy` | type | Outbound network policy for an exact process environment. `blocked` denies |
| `AgentProfileRef` | type | Portable profile reference: inline profile or provider catalog id. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentEnvironment`, `AgentEnvironmentCapabilities`, `AgentEnvironmentEvent`, `AgentEnvironmentProvider`, `AgentEnvironmentQuery`, `AgentEnvironmentSummary`, `AgentExactProcessEnvironmentQuery`, `AgentExactProcessManager`, `AgentSession`, `AgentSessionRef`, `AgentTurnInput`, `AgentTurnResult`, `CheckpointRef`, `CheckpointRequest`, `CreateAgentEnvironmentInput`, `ExecRequest`, `ExecResult`, `ForkRequest`, `PlacementInfo`, `ResourceRequest`, `WorkspaceRequest`, `AgentEnvironmentStatus`, `AgentExactProcessEgressMode`, `AgentSessionStatus`.

### Live trace analysis

Import from `@tangle-network/agent-runtime/analyst-loop` — 14 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `iterationsToTraceStore` | function | Build an in-memory `TraceAnalysisStore` over a loop round's iterations. Fail-loud on an |
| `runAnalystLoop` | function | `runAnalystLoop` — the one call agent apps reach for to close the |
| `AnalystRegistryLike` | interface | Narrowed shape we accept for `AnalystRegistry` so the orchestrator |
| `AnalystRegistryStreamingLike` | interface | Narrow the `AnalystRegistryLike` further when we need streaming: the |
| `FindingsStoreLike` | interface | Narrowed shape we accept for `FindingsStore`. |
| `ImprovementProposalSource` | interface | Agent-surface bridge — proposes prompt, skill, tool, and scaffolding edits. |
| `KnowledgeProposalSource` | interface | Knowledge-side bridge — consumers wire `proposeFromFindings` from agent-knowledge. |
| `AnalystLoopEvent` | type | Events emitted by `runAnalystLoop` via `opts.onEvent`. UIs and |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `ImprovementEditBatch`, `ImprovementReport`, `KnowledgeProposalBatch`, `KnowledgeReport`, `RunAnalystLoopOpts`, `RunAnalystLoopResult`.

### Knowledge-base improvement workflows

Import from `@tangle-network/agent-runtime/knowledge` — 24 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `buildKnowledgeImprovementExperimentBundles` | function | Attach both frozen knowledge inputs to one otherwise-identical bundle pair. |
| `createAgentKnowledgeReadinessCheck` | function | Build the default readiness check backed by `@tangle-network/agent-knowledge` validation and scoring. |
| `createKnowledgeImprovementActivationExecutor` | function | Apply or restore one local knowledge candidate through the shared activation contract. |
| `createSupervisedKnowledgeUpdater` | function | Create an `improveKnowledgeBase` update callback backed by runtime supervision. |
| `formatSupervisedKnowledgeTask` | function | Format the supervisor task with the KB root, readiness requirements, current findings, and metadata. |
| `knowledgeReadinessDeliverable` | function | Build the completion check a supervised KB update uses to stop only when the KB is ready. |
| `runKnowledgeImprovementJob` | function | Produce a frozen KB candidate while leaving live knowledge content unchanged. |
| `runSupervisedKnowledgeUpdate` | function | Run a runtime supervisor that updates one candidate knowledge base and stops on readiness. |
| `RESEARCH_SUPERVISOR_SYSTEM_PROMPT` | const | Standing prompt for a supervisor that grows a shared knowledge base through spawned researchers. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentKnowledgeReadinessCheckOptions`, `CreateKnowledgeImprovementActivationExecutorOptions`, `KnowledgeImprovementActivationExecutor`, `KnowledgeImprovementCandidatePair`, `KnowledgeImprovementExperimentBundles`, `KnowledgeImprovementJobMeasurement`, `KnowledgeImprovementJobResult`, `KnowledgeReadinessCheckInput`, `RunKnowledgeImprovementJobOptions`, `SupervisedKnowledgeUpdateInput`, `SupervisedKnowledgeUpdateOptions`, `SupervisedKnowledgeUpdateResult`, `KnowledgeReadinessCheck`, `KnowledgeReadinessCheckResult`, `SupervisedKnowledgeUpdater`.

### Built-in agent profiles

Import from `@tangle-network/agent-runtime/profiles` — 54 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `appendFindings` | function | Append findings to a workspace, writing one Markdown file per finding |
| `buildAuditorSystemPrompt` | function | Build a system prompt for a single auditor iteration. |
| `coderTaskToPrompt` | function | Render a `CoderTask` into the per-task instruction handed to the coder profile. |
| `createInProcessUiAuditEnvironmentProvider` | function | Create a local Playwright UI-audit provider. |
| `createResearcherValidator` | function | Build a validator that closes over a specific `ResearchTask`'s constraints. |
| `createUiAuditorValidator` | function | Build a `Validator` that rejects off-lens findings and findings missing screenshot evidence. |
| `decodeAuditTaskEnvelope` | function | Parse a task envelope back out of a prompt string. Returns undefined if |
| `encodeAuditTaskEnvelope` | function | Wrap a `UiAuditTask` in a machine-readable envelope so iterations are self-describing. |
| `formatAuditorPrompt` | function | Produce the user message for one audit iteration: lens, captures to take, and the task envelope. |
| `initAuditWorkspace` | function | Create the `issues/`, `screenshots/`, and `registry.json` scaffold in a new audit workspace. |
| `multiHarnessResearcherFanout` | function | Build a fanout topology over multiple harnesses. The kernel round-robins |
| `parseAuditorEvents` | function | Parse raw environment events from an audit iteration into structured `UiAuditOutput`. |
| `readAuditRegistry` | function | Read and validate the `registry.json` from an audit workspace. |
| `registerCaptures` | function | Record screenshots taken for a route in the registry, without filing a |
| `researcherProfile` | function | Build a source-grounded researcher profile with output parsing and validation. |
| `summarizeRegistry` | function | Compute finding counts by severity, lens, and route from an `AuditRegistry`. |
| `uiAuditorProfile` | function | Preset `runAgentRounds` bundle for vision-driven UI audits: returns the `AgentRunSpec`, output adapter, validator, and prompt formatter the loop kernel needs. |
| `writeAuditIndex` | function | Regenerate `<workspace>/index.md` from registry.json. |
| `LENS_BRIEFS` | const | Per-lens auditor briefs: concrete signals to look for and cross-lens distinctions to respect. |
| `SHARED_AUDITOR_RULES` | const | Cross-lens rules injected into every UI audit iteration: finding quality standards and scope limits. |
| `UI_FINDING_SEVERITIES` | const | Frozen severity tuple, ordered worst → least bad for sort/report. |
| `UI_LENSES` | const | Frozen tuple of lenses for validation + iteration. |
| `InProcessUiAuditEnvironmentProvider` | interface | Official provider with explicit shared-browser shutdown. |
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

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AppendFindingsResult`, `AuditIndex`, `AuditRegistry`, `AuditRegistryCapture`, `BrowserContextHandle`, `BrowserHandle`, `CoderTask`, `InProcessUiAuditEnvironmentProviderOptions`, `MultiHarnessResearcherFanoutOptions`, `PageHandle`, `RegisterCapturesOptions`, `UiAuditCapture`, `UiAuditCaptureRequest`, `UiAuditorProfileOptions`, `UiAuditViewport`, `UiJudgeInput`, `UiJudgeOutput`, `UiJudgeTokenUsage`, `UiJudge`.

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

### PrimeIntellect packages, runs, and trace import

Import from `@tangle-network/agent-runtime/primeintellect` — 25 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `createPrimeIntellectPackage` | function | Build a complete PrimeIntellect Verifiers package without writing to disk. |
| `importPrimeIntellectTraces` | function | Convert all Prime traces to agent-eval RunRecords while retaining one shared run config. |
| `parsePrimeIntellectTraces` | function | Parse Prime's durable `traces.jsonl` and reject malformed rows with a line number. |
| `primeIntellectModelEndpoint` | function | Return Prime's intercepted model endpoint for the product's normal provider. |
| `primeIntellectTraceToRunRecord` | function | Project one complete Prime trace into the common agent-eval analysis row. |
| `readPrimeIntellectEpisodeContext` | function | Read and validate the private process contract installed by the generated Prime harness. |
| `runPrimeIntellectProgram` | function | Execute the caller's canonical runtime program inside a Prime rollout. |
| `writePrimeIntellectPackage` | function | Write a bundle through a sibling temporary directory, then rename it into place. |
| `PrimeIntellectPublicTask` | interface | The answer-free task exposed to the caller's runtime program. |
| `PrimeIntellectRunner` | interface | Files and commands that make the caller's real agent program runnable. |
| `PrimeIntellectTask` | interface | One immutable problem. References stay inside Prime's task process. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `PrimeIntellectEpisodeContext`, `PrimeIntellectPackageBundle`, `PrimeIntellectPackageManifest`, `PrimeIntellectPackageOptions`, `PrimeIntellectTrace`, `PrimeIntellectTraceImportOptions`, `RunPrimeIntellectProgramOptions`, `WritePrimeIntellectPackageOptions`, `PrimeIntellectContent`, `PrimeIntellectJson`, `PrimeIntellectMessage`, `PrimeIntellectScoring`, `PrimeIntellectSetupCommand`, `PrimeIntellectSplit`.

### Candidate preparation, execution, scoring, and receipts

Import from `@tangle-network/agent-runtime/candidate-execution` — 102 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `applyExactAgentProfileDiff` | function | Apply one exact diff and reject any value that cannot be preserved canonically. |
| `assertCandidateProfileBinding` | function | Prove the measured generic profile and sealed candidate profile describe the same behavior. |
| `buildAgentCandidateBundle` | function | Compile one measured profile/code candidate into the immutable execution |
| `candidateExecutionClaim` | function | Extract the complete durable claim from a prepared execution. |
| `candidateKnowledgeExecutionPaths` | function | Deterministic, signed locations used by every candidate executor. |
| `captureAgentCandidateWorkspace` | function | Capture one exact regular-file workspace for immutable candidate execution. |
| `captureAgentCandidateWorkspaceFiles` | function | Capture detached files returned by a remote executor into the standard archive. |
| `createAgentCandidateWorkspacePort` | function | Create the standard bounded materializer for candidate execution ports. |
| `createProtectedAgentCandidateModelPort` | function | Bind a protected model-grant service to the immutable candidate runtime. |
| `disposePreparedAgentCandidateExecution` | function | Revoke reservations held by a prepared candidate that will not be executed. |
| `exactProcessProviderAsCandidateExecutor` | function | Adapt one neutral exact-process provider to Runtime's trusted candidate boundary. |
| `executePreparedAgentCandidate` | function | Executes and finalizes one durably claimed candidate without exposing an unproven result. |
| `parseExactAgentProfile` | function | Parse a complete profile without silently discarding unsupported fields. |
| `parseExactAgentProfileDiff` | function | Parse a profile diff without silently discarding unsupported fields. |
| `persistCandidateOutputArtifact` | function | Persist evaluator evidence, read it back, and bind the returned locator to the exact bytes. |
| `prepareAgentCandidateExecution` | function | Materializes a verified candidate into one immutable evaluator-owned execution plan. |
| `recoverExpiredAgentCandidateExecution` | function | Close an expired crashed attempt from persisted non-secret handles, then record failure. |
| `sealAgentCandidateBundle` | function | Validate and content-address a candidate bundle before it crosses an approval boundary. |
| `verifyAgentCandidateBundle` | function | Verifies every digest, resource, workspace, and Git object in a candidate bundle. |
| `AGENT_CANDIDATE_EXECUTION_SUPPORT` | const | Surfaces admitted by Runtime's verifier before an environment adapter is selected. |
| `CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV` | const | Environment variable containing the materialized retrieval configuration path. |
| `CANDIDATE_KNOWLEDGE_ROOT_ENV` | const | Environment variable containing the materialized candidate knowledge root. |
| `CANDIDATE_TRACE_ENV` | const | Environment keys used to propagate immutable candidate trace identity. |
| `CANDIDATE_TRACE_TAGS` | const | Protected trace tags that bind a run to one prepared candidate execution. |
| `FileAgentCandidateExecutionClaimStore` | class | Cross-process lifecycle implemented as fsynced, create-if-absent records. |
| `InMemoryAgentCandidateExecutionClaimStore` | class | Single-process lifecycle implementation. |
| `AgentCandidateArtifactPort` | interface | Reads one content-addressed object from the closed S3/IPFS locator set. |
| `AgentCandidateBenchmarkGraderIdentity` | interface | Immutable grader identity admitted for one benchmark task. |
| `AgentCandidateBenchmarkGraderPort` | interface | Evaluator-owned executable grader, pinned by immutable implementation bytes. |
| `AgentCandidateCodeSurfaceSource` | interface | The only accepted path from an agent-eval code candidate to executable bytes. |
| `AgentCandidateExecutionAttemptRecord` | interface | Persisted state available to a fresh trusted recovery worker after a crash. |
| `AgentCandidateExecutionClaim` | interface | Immutable signed identity stored for one execution attempt. |
| `AgentCandidateExecutionClaimStore` | interface | Atomic one-shot store for candidate execution attempts. |
| `AgentCandidateExecutionCleanupHandles` | interface | Non-secret identities a trusted recovery worker needs to close an abandoned attempt. |
| `AgentCandidateExecutionLease` | interface | Secret capability required to finish the acquired attempt. |
| `AgentCandidateExecutionRecoveryEvidence` | interface | Trusted, independently observed closure facts for one expired winning lease. |
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
| `BuildAgentCandidateBundleInput` | interface | Complete measured surfaces and execution policy compiled into one candidate bundle. |
| `PreparedAgentCandidateKnowledge` | interface | Exact file-backed knowledge admitted by the candidate bundle. |
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
| `AgentCandidateModelGrantReservation` | type | Secret-free response from the service's reservation endpoint. |
| `AgentCandidateModelLimits` | type | Limits mechanically enforced by the evaluator-owned model gateway. |
| `AgentCandidateProfileSource` | type | A complete profile that can be frozen without losing behavior. |
| `VerifiedAgentCandidateTaskOutcome` | type | Branded task outcome that has survived independent evaluator verification. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentCandidateContainerPort`, `AgentCandidateExecutionAttemptRef`, `AgentCandidateExecutionPorts`, `AgentCandidateExecutorWorkspaceFile`, `AgentCandidateExecutorWorkspaceInput`, `AgentCandidateMemoryPort`, `AgentCandidateMemoryResetResult`, `AgentCandidateModelPort`, `AgentCandidatePreparationEvidence`, `AgentCandidateProtectedModelActivation`, `AgentCandidateProtectedModelReservation`, `AgentCandidateProtectedModelSettlement`, `AgentCandidateProtectedRunCapture`, `AgentCandidateVerificationPorts`, `AgentCandidateWorkspaceArchiveLimits`, `CanonicalCandidateDocument`, `CaptureAgentCandidateWorkspaceOptions`, `CapturedAgentCandidateWorkspace`, `CreateAgentCandidateWorkspacePortOptions`, `CreateProtectedAgentCandidateModelPortOptions`, `DisposePreparedAgentCandidateOptions`, `ExactProcessCandidateExecutorOptions`, `ExecutePreparedAgentCandidateOptions`, `FileAgentCandidateExecutionClaimStoreOptions`, `PrepareAgentCandidateExecutionOptions`, `PreparedAgentCandidateExecution`, `PreparedAgentCandidateInstruction`, `PreparedAgentCandidateLaunch`, `PreparedAgentCandidateTrace`, `RecoverExpiredAgentCandidateOptions`, `ResolvedAgentCandidateContainer`, `VerifiedAgentCandidate`, `AgentCandidateModelGrantActivateInput`, `AgentCandidateModelGrantReserveInput`, `AgentCandidateModelGrantSettleInput`, `AgentCandidateOutputPurpose`, `AgentCandidateRetryRejection`, `AgentCandidateRunFinalization`.

### Validated Runtime test fixtures

Import from `@tangle-network/agent-runtime/testing` — 1 export.

| Symbol | Kind | Summary |
|---|---|---|
| `loadAgentImprovementProposalFixture` | function | Load an isolated, production-validated Runtime proposal for consumer tests. |

### Delegation and coordination MCP servers

Import from `@tangle-network/agent-runtime/mcp` — 187 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `buildDelegationTraceSpans` | function | Derive the compact span tree for ONE loop run from its buffered |
| `capDelegationTrace` | function | Enforce the trace caps over an ordered (oldest-first) span list. Drops the |
| `captureWorktreeDiff` | function | Stage worker changes and return the diff + shortstat, excluding declared input paths. |
| `coderTaskFromArgs` | function | Canonical `DelegateCodeArgs` → `CoderTask` mapping — the single source for |
| `composeLoopTraceEmitters` | function | Fan one `LoopTraceEvent` stream into several emitters — e.g. the |
| `createCoordinationTools` | function | Build the driver's MCP tools over a live scope. |
| `createDelegateFeedbackHandler` | function | Build the MCP tool handler that persists feedback events and attaches them to delegation records. |
| `createDelegateHandler` | function | Build the `delegate` tool handler. Closes over the injected supervisor substrate (`router` / |
| `createDelegateUiAuditHandler` | function | Build the MCP tool handler that validates input, deduplicates via idempotency key, and enqueues a UI audit. |
| `createDelegationExecutor` | function | Wrap an official provider for delegated work. |
| `createDelegationHistoryHandler` | function | Build the MCP tool handler that reads filtered past delegations from a `DelegationTaskQueue`. |
| `createDelegationStatusHandler` | function | Build the MCP tool handler that polls a `DelegationTaskQueue` for task status. |
| `createDelegationTraceCollector` | function | Build a `DelegationTraceCollector` that buffers loop-trace events and converts them to spans on settle. |
| `createDetachedTurnResumeDriver` | function | Resume detached work by resolving the persisted environment and session. |
| `createFleetWorkspaceExecutor` | function | Run delegated environments on existing Tangle fleet machines while relying |
| `createInProcessExecutor` | function | Run delegated coding workers as local processes in isolated git worktrees. |
| `createInProcessTransport` | function | In-process pair of `Readable` + `Writable` streams suitable for driving |
| `createKbGate` | function | Build a fail-closed KB gate. The returned function runs the built-in floor |
| `createMcpServer` | function | Stdio JSON-RPC MCP server exposing the delegation tools (`delegate`, `delegate_feedback`, `delegation_status`, `delegation_history`, optional `delegate_ui_audit`) to sandbox coding-harness agents. |
| `createMemoryToolServer` | function | Build the memory MCP server: `memory_search` (lexical top-k over the rows) |
| `createPropagatingTraceEmitter` | function | Create a LoopTraceEmitter that: |
| `createStdioToolServer` | function | Build the generic stdio JSON-RPC tool server. |
| `createWorktree` | function | Checkout a fresh git worktree for a delegation run on a new branch under `variantsDir`. |
| `detachedSessionDelegate` | function | Build the provider-backed coder delegate. Multi-variant work fans out across |
| `detachedTurnEvents` | function | Rebuild the terminal event shape consumed by ordinary output adapters. |
| `eventToSnapshot` | function | Project a `FeedbackEvent` down to the snapshot shape carried on |
| `formatDetachedSessionRef` | function | Encode a detached session reference. The environment id is absent before |
| `hashIdempotencyInput` | function | Best-effort stable hash for use as `idempotencyKey`. Not cryptographic; |
| `liftFindings` | function | Lift validated raw rows into `AnalystFinding`s (agent-eval `makeFinding` stamps `finding_id`/ |
| `makeCheckRunner` | function | Build a `run_analyst` runner over a kind directory. |
| `mcpToolsForRuntimeMcp` | function | Returns the queue-bound delegation tools projected into OpenAI Chat |
| `mcpToolsForRuntimeMcpSubset` | function | Subset filter — return only the projected tools whose `function.name` |
| `parseCodexTokenUsage` | function | Parse and validate the one terminal usage event emitted by `codex exec --json`. |
| `parseDetachedSessionRef` | function | Parse a detached session reference and reject retired wire names. |
| `parseMemoryItems` | function | Coerce an untrusted JSON array into validated `MemoryItem` rows. |
| `readMemoryItemsFile` | function | Read a memory store file: a JSON array, or JSONL (one `MemoryItem` per line). |
| `readTraceContextFromEnv` | function | Read trace context from the process environment. |
| `removeWorktree` | function | Remove a git worktree and delete its branch. Already-removed paths are harmless; every other |
| `renderTrace` | function | Render a worker's trace (tool calls + results) into the text an analyst lens reads. Generic over |
| `resolveMemoryFromEnv` | function | Resolve the bin's memory from `AGENT_MEMORY_FILE` (durable store) and/or |
| `runCheck` | function | Run ONE lens over a trace → findings. Generic over any kind: prompt = the lens + the agent-eval |
| `runDetachedTurn` | function | Dispatch one detached session and await its terminal result. |
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
| `LOCAL_HARNESSES` | const | Local coding harness available inside the sandbox. |
| `MEMORY_FILE_ENV` | const | Env var naming the durable row store file the memory bin loads (the |
| `MEMORY_ITEMS_ENV` | const | Env var carrying inline JSON `MemoryItem` rows (win over file rows on id). |
| `MEMORY_LOG_ENV` | const | Env var naming the JSONL retrieval log (one row per `memory_search`). |
| `MEMORY_NAME_ENV` | const | Env var overriding the served display name (default 'agent-memory'). |
| `CodexExecutionDiagnosticError` | class | Thrown when reproducible Codex exits without one valid terminal usage event. |
| `DelegationPersistenceError` | class | A delegation-store read or write failed (filesystem error, store |
| `DelegationStateCorruptError` | class | The persisted delegation state exists but cannot be parsed into |
| `DelegationTaskQueue` | class | In-process queue for async delegation tasks — submit, cancel, poll status, and read history. |
| `FileDelegationStore` | class | JSON-file persistence for the delegation queue. Each write serializes |
| `InMemoryDelegationStore` | class | In-memory `DelegationStore` — suitable for single-process use and tests. |
| `InMemoryFeedbackStore` | class | In-memory `FeedbackStore` — suitable for single-process use and tests. |
| `AgentMemorySpec` | interface | The `memory` artifact payload — HOW a profile's memory is stored and served: |
| `Check` | interface | One lens — a composable analyst kind. Identity fields mirror `TraceAnalystKindSpec` so a kind is |
| `CodexExecutionEvidence` | interface | Zero-model-call evidence for the exact Codex process about to run. |
| `CodexExecutionFailureDiagnostic` | interface | Bounded, credential-redacted process context attached when reproducible Codex output fails |
| `CodexExecutionPolicy` | interface | Isolation settings asserted before a reproducible Codex run is allowed to start. |
| `CodexTokenUsage` | interface | Exact aggregate usage emitted by Codex's terminal `turn.completed` JSONL event. |
| `CoordinationTools` | interface | The supervisor-side toolbox returned by {@link createCoordinationTools}: the MCP tool |
| `DelegateArgs` | interface | Parsed `delegate` tool arguments. |
| `DelegateCodeConfig` | interface | Minimal `CoderTask` overrides exposed over the MCP wire. The full |
| `DelegateUiAuditRoute` | interface | Optional per-route capture spec the agent surfaces over the wire. |
| `DelegationExecutor` | interface | Provider plus diagnostics used by the delegation server. |
| `DelegationRecord` | interface | Must be JSON-safe end to end (`args`, `result`, `error`, `feedback`) — |
| `DelegationResumeDriver` | interface | Re-attaches restored in-flight records to their detached runs. The queue |
| `DelegationTraceCollector` | interface | Per-delegation trace collector. Buffers `LoopTraceEvent`s per runId |
| `DelegationTraceSpan` | interface | One span of a delegation's compact trace. Flat (parent linkage by id), all |
| `DetachedSessionRefParts` | interface | Decoded `DelegationRecord.detachedSessionRef`. |
| `DetachedTurn` | interface | Terminal payload of a detached provider turn. |
| `FleetHandle` | interface | Existing Tangle fleet surface used by the MCP entrypoint. |
| `MemoryItem` | interface | One row of agent memory: a crisp lesson/fact with provenance. |
| `ResearchOutputShape` | interface | Provider-neutral research output carried over the MCP boundary. The MCP |
| `ResolvedMemoryEnv` | interface | What the memory bin resolved from its environment. |
| `SettledWorker` | interface | A worker the driver has drained via `await_event`. |
| `TraceContext` | interface | Trace context propagation for MCP subprocess. |
| `UiAuditorDelegationOutput` | interface | Wire-shape of a completed UI-audit delegation. The `findings` array |
| `CoderReviewer` | type | Optional adversarial reviewer over a coder candidate that already passed |
| `CoordinationEvent` | type | Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for |
| `DelegateResult` | type | The synchronous result the `delegate` tool returns to the calling agent: the delivered output (or |
| `DelegationResultPayload` | type | Polymorphic `result` field: `CoderOutput` when the underlying profile |
| `DelegationResumeTick` | type | One observation of a detached run, mapped 1:1 from a single-tick driver |
| `GitRunner` | type | Pluggable git runner (sync) — replaceable in tests. |
| `UiAuditorDelegate` | type | UI-auditor delegate — fully consumer-injected. agent-runtime ships no |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AnalystRegistry`, `CappedDelegationTrace`, `CheckRunnerOptions`, `CoderReview`, `CoordinationToolsOptions`, `CreateKbGateOptions`, `CreateMemoryToolServerOptions`, `CreateWorktreeOptions`, `DelegateCodeArgs`, `DelegateCodeResult`, `DelegateFeedbackArgs`, `DelegateFeedbackResult`, `DelegateHandlerOptions`, `DelegateResearchArgs`, `DelegateResearchConfig`, `DelegateResearchResult`, `DelegateRunCtx`, `DelegateUiAuditArgs`, `DelegateUiAuditConfig`, `DelegateUiAuditResult`, `DelegationError`, `DelegationFeedbackSnapshot`, `DelegationHistoryArgs`, `DelegationHistoryEntry`, `DelegationHistoryResult`, `DelegationProgress`, `DelegationResumeContext`, `DelegationRunContext`, `DelegationStatusArgs`, `DelegationStatusResult`, `DelegationStore`, `DelegationTaskQueueOptions`, `DelegationTraceCaps`, `DetachedSessionDelegateOptions`, `DetachedTurnResumeDriverOptions`, `DiffOptions`, `DiffResult`, `FactCandidate`, `FactJudge`, `FactJudgeVerdict`, `FeedbackEvent`, `FeedbackRating`, `FeedbackRefersTo`, `FeedbackStore`, `FileDelegationStoreOptions`, `FleetWorkspaceExecutorOptions`, `InProcessExecutorOptions`, `JsonRpcMessage`, `JsonRpcResponse`, `KbGateResult`, `LocalHarnessResult`, `McpServer`, `McpServerOptions`, `McpToolDescriptor`, `McpTransport`, `Question`, `QuestionRecord`, `RemoveWorktreeOptions`, `RunDetachedTurnOptions`, `RunLocalHarnessOptions`, `SettleDetachedCoderTurnOptions`, `StdioToolDescriptor`, `StdioToolServer`, `StdioToolServerOptions`, `SubmitInput`, `SubmitOutput`, `WorktreeHandle`, `CoderDelegate`, `DelegationProfile`, `DelegationStatus`, `DetachedWinnerSelection`, `LocalHarness`, `MakeWorkerAgent`, `QuestionDecision`, `QuestionPolicy`, `ResearchSource`.

## 2. agent-eval — substrate primitives to REUSE

The scoring/measurement/judge substrate. **Do NOT re-implement a judge, an authenticity check, a verifier, a statistics routine, a profile-matrix runner, or usage extraction** — import them from here. The category→subpath mapping is curated; the symbols are generated.

### JUDGE — LLM-as-judge, panels, calibration

Import from `@tangle-network/agent-eval` — 26 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `cachedJudge` | function | Wrap a `JudgeConfig` so repeat judgments of the same artifact are served |
| `calibrateJudge` | function | Measure judge quality against human gold labels: computes Cohen's κ, Pearson correlation, and MAE over matched item ids. |
| `compilerJudge` | function | Build a `SandboxJudgeSpec` that scores whether the harness compiles without errors. |
| `contractJudge` | function | Adapt trace contracts to a campaign `JudgeConfig`. One judge dimension per |
| `createAntiSlopJudge` | function | Create a reusable Judge function from an anti-slop config. |
| `createIntentMatchJudge` | function | Factory: pin LLM options once, return a closure. |
| `createReferenceEquivalenceJudge` | function | Build the campaign-native expected-answer judge. |
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
| `runReferenceEquivalenceJudge` | function | Direct-call adapter over the campaign judge for product callers. |
| `runSemanticConceptJudge` | function | Run the semantic concept judge. Soft-fails to available=false on |
| `securityJudge` | function | Build a `SandboxJudgeSpec` that scores the harness output for security issues via a security scanner. |
| `testJudge` | function | Build a `SandboxJudgeSpec` that scores the harness by its test-suite pass rate. |
| `traceJudge` | function | Wrap a single JudgeFn so its LLM call emits a traced span. |
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
| `VerificationReport` | interface | Extends the substrate verdict spine: `valid` = `allPass`; `score` is the |
| `LayerStatus` | type | Multi-layer verifier — ordered pipeline of verification layers. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `Finding`, `VerifyOptions`.

### STATISTICS — significance, intervals, effect size

Import from `@tangle-network/agent-eval` — 52 exports.

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
| `pairedCohensDz` | function | Cohen's dz for paired observations: mean(after - before) divided by the |
| `pairedEvalueSequence` | function | Run the paired e-value sequence over an in-order delta stream. |
| `pairedMde` | function | Minimum detectable paired effect (standardised units) for a target paired |
| `pairedRiskDifference` | function | Paired risk difference (the effect-size companion to {@link mcnemar}): the |
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
| `wilcoxonSignedRank` | function | Wilcoxon signed-rank test — paired non-parametric alternative. |
| `wilson` | function | Wilson score interval for a binomial proportion. Correct at small n and near |
| `normalizeScores` | const | Identity: dimensions already follow "higher = better" by prompt convention |
| `McNemarResult` | interface | Result of a McNemar paired-binary significance test. |
| `ProportionInterval` | interface | A binomial proportion estimate with a confidence interval. |
| `RiskDifferenceResult` | interface | A paired binary effect size (treatment rate − control rate) with a CI. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `BootstrapOptions`, `BootstrapResult`, `ClusterBootstrapInterval`, `CorpusAgreementOptions`, `CorpusAgreementPerDimension`, `CorpusAgreementReport`, `CorpusScoreRecord`, `EProcess`, `EProcessOptions`, `EProcessState`, `EProcessStep`, `PairedBootstrapOptions`, `PairedBootstrapResult`, `WeightedCompositeInput`, `WeightedCompositeResult`, `CliffsMagnitude`.

### CAMPAIGN — profile matrix, gates, improvement loop

Import from `@tangle-network/agent-eval/campaign` — 325 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `acquireSingleRunLock` | function | Acquire the lock or throw naming the live holder. A stale lock (holder pid |
| `analyzeCrossSurfaceInteractions` | function | Build the complete cross-surface evidence matrix and derive all three frozen |
| `assertCampaignDesign` | function | Reject campaign designs whose denominator cannot be identified exactly. |
| `assertCampaignSplitIdentity` | function | Refuse a campaign whose retained task identities contradict its split digest. |
| `assertCodeSurfaceIdentity` | function | Validate the immutable identity shape; the owning executor verifies the Git objects and patch. |
| `assertComponentSurface` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `buildAnalystSurfaceDispatch` | function | Build the `dispatchWithSurface(surface, scenario, ctx)` the improvement loop |
| `buildEvidenceVector` | function | The Evidence Bus. For each objective, pair candidate vs baseline by full |
| `buildLoopProvenanceRecord` | function | Build the durable provenance record from a completed loop result. |
| `campaignBreakdown` | function | Per-candidate evidence a reflective/patch proposer grounds its next proposal |
| `campaignMeanComposite` | function | Mean composite across cells with complete task-quality evidence. |
| `campaignMeasurementDigest` | function | Digest the exact campaign fields that can affect a measured comparison. |
| `campaignScenarioIdentity` | function | Redacted but independently verifiable identity of one complete scenario. |
| `campaignSplitDigest` | function | Canonical identity of the exact scenario payloads and replicate count. |
| `campaignSplitDigestFromIdentities` | function | Canonical split identity reconstructed from redacted scenario identities. |
| `canonicalDigest` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `classifyUngroundedLiterals` | function | Scan revised artifact text for single-quoted single-word literals (the |
| `codeSurfaceIdentityMaterial` | function | Canonical, location-independent identity of a finalized code candidate. |
| `compareOptimizationMethods` | function | Compare complete optimization methods on disjoint train, selection, and final test data. |
| `compareRankKeys` | function | Compare fixed-length lexicographic rank keys where each element is higher-is-better. |
| `componentSurfaceIdentityMaterial` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `composeGate` | function | Compose gates — all must `ship` for the composite to `ship`. First |
| `costFromLedgerSummary` | function | Keep the cost fields a custom optimization method must report. |
| `createReferenceEquivalenceJudge` | function | Build the campaign-native expected-answer judge. |
| `createRunCostLedger` | function | Open the durable spend account stored beside a logical run. |
| `defaultProductionGate` | function | Opinionated production gate composing held-out significance, red-team, reward-hacking, and canary checks into a single `Gate.decide` decision. |
| `detectScale` | function | Detect the native scale of a set of scores: 0-100 when any magnitude clears |
| `dimensionRegressions` | function | Per-critical-dimension regression guard. For each dimension, pair the |
| `discoverEvalFixtures` | function | Walk `evalsDir` and return the relative name of every fixture directory (one containing an exact-case `PROMPT.md`). |
| `emitLoopProvenance` | function | Build the provenance record + OTel spans and persist them durably under the |
| `externalTextOptimizationMethod` | function | Adapt a third-party text optimizer without reimplementing its search. |
| `failureModeRecallJudge` | function | Deterministic, ground-truth judge for analyst findings. Composite = |
| `fsCampaignStorage` | function | Node-filesystem storage — the default. Lazily requires `node:fs` so the |
| `gepaOptimizationMethod` | function | Turn an optional GEPA installation into an `OptimizationMethod`. |
| `gitWorktreeAdapter` | function | Git-backed `WorktreeAdapter`: creates isolated worktrees on fresh branches, commits agent changes, and discards losers. |
| `heldOutGate` | function | Composable held-out gate: ships only when the PAIRED bootstrap CI lower bound |
| `heldoutSignificance` | function | Significance of the held-out composite lift: ship only when the paired |
| `inMemoryCampaignStorage` | function | In-memory storage for filesystem-less runtimes. Artifacts + trace spans |
| `isProposedCandidate` | function | Type guard: a proposal carrying its rationale vs a bare |
| `isTransientTransportFailure` | function | True when the error text describes an infrastructure hiccup that should be |
| `labelTrustRank` | function | Ordinal rank for a label-trust tier; absent ⇒ `unverified` (rank 0). |
| `llmJudge` | function | Build a campaign-shaped `JudgeConfig` whose `score()` makes ONE LLM call |
| `loadEvalFixture` | function | Load ONE fixture by name: reads `PROMPT.md` (plus `EVAL.ts`/`EVAL.tsx` and `package.json` under |
| `loadEvalFixtureScenarios` | function | Load fixtures (all discovered, or just `names`) as campaign `Scenario`s tagged `eval-fixture`. |
| `loopProvenanceArgsFromResult` | function | One translation from a completed improvement loop into durable evidence. |
| `loopProvenanceSpans` | function | Build the loop's OTLP-ingestable spans from a provenance record. One root |
| `makePlaybackDispatch` | function | Adapt a `PlaybackDriver` into a `runProfileMatrix` dispatch. The artifact the |
| `neutralizationGate` | function | Composable placebo gate: ships only when the candidate's held-out lift is NOT |
| `neutralizeText` | function | Blank every non-whitespace character to a 1-byte filler while preserving all |
| `openAutoPr` | function | Open a GitHub PR for a gate-approved surface promotion, attaching the manifest hash, gate verdict, and diff as the PR body. |
| `openSearchLedger` | function | Open a durable filesystem search ledger. Construction performs no I/O; the |
| `optimizationTokenUsageFromSummary` | function | Preserve every optimizer token class while keeping total input and output explicit. |
| `pairHoldout` | function | Pair candidate vs baseline holdout observations by FULL cellId. `select` |
| `paretoSignificanceGate` | function | Wrap the bus + a policy as a `Gate`. Plugs into the existing |
| `planCampaignRun` | function | Plan a campaign WITHOUT dispatching: computes the manifest hash and the per-cell |
| `planEvalFixtureRun` | function | Dry-run planner for a fixture campaign: loads the scenarios, delegates to `planCampaignRun`, |
| `powerPreflight` | function | Estimate the minimum detectable lift a paired-holdout improvement run can |
| `provenanceRecordPath` | function | Canonical durable paths under the run dir. |
| `provenanceSpansPath` | function | Canonical path for the durable OTLP spans JSONL file under a loop run directory. |
| `renderScoreboardMarkdown` | function | Render the scoreboard as a launch-readiness Markdown document — the literal |
| `renderSurfaceDiff` | function | Canonical customer-visible description of the exact before/after surfaces. |
| `resolveRunDir` | function | Resolve a campaign `runDir`. An absolute path is honored as-is (the caller |
| `resolveWorktreePath` | function | Resolve a code candidate for evaluation only after verifying its immutable |
| `rolloutArgumentDiff` | function | Deterministic per-field diff of call arguments between passing and failing |
| `runCampaign` | function | Core campaign orchestrator: fan scenarios through dispatch, score with judges, aggregate bootstrap CIs, and persist reproducible `CampaignResult` records. |
| `runEval` | function | Simplest evaluation preset: run scenarios through dispatch, score with judges, and return a `CampaignResult` — no optimizer, no gate, no PR. |
| `runImprovementLoop` | function | Gated-promotion shell over `runOptimization`: scores the winner against the baseline on a holdout set, runs the release gate, and optionally opens a PR. |
| `runOptimization` | function | Improvement loop body: N generations of propose → campaign → rank, maintaining a Pareto frontier and one global incumbent across generations. |
| `runProfileMatrix` | function | Profile × scenario matrix runner: fan N agent profiles across M scenarios, project each cell to a validated `RunRecord` with real token usage, and enforce the backend-integrity guard before returning. |
| `scoreboardSummary` | function | Roll the per-requirement rows up into the launch headline counts. |
| `scoreDiscrimination` | function | Rank scenarios by how well they DISCRIMINATE candidates. |
| `scoreUserStory` | function | Score one story's produced state against its requirements. Thin wrapper over |
| `selectDiscriminative` | function | Select the top-`k` most discriminative scenario ids for a holdout, EXCLUDING |
| `sequentialDecide` | function | `SurfaceProposer.decide` adapter — stops the optimization loop the moment |
| `sequentialPairedGate` | function | Anytime-valid sequential paired gate. Conforms to the existing `Gate` |
| `skillOptOptimizationMethod` | function | Run Microsoft's SkillOpt trainer as a complete optimization method. |
| `surfaceContentHash` | function | Full SHA-256 content identity for a prompt or finalized code surface. |
| `surfaceHash` | function | Short loop key derived from the same content identity as provenance. |
| `tangleTracesRoot` | function | The shared, out-of-repo root for campaign/benchmark run bundles. Keeping run |
| `userStoryScoreboard` | function | Flatten story verdicts into the per-requirement scoreboard — the literal |
| `validateSearchLedgerEvent` | function | Validate and return a canonical copy. Arrays whose order is not semantic are |
| `verifyCodeSurface` | function | Verify a finalized code surface against its current checkout. This rejects |
| `verifyLoopProvenanceRecord` | function | Recompute and validate the self-addressed durable record. |
| `paretoPolicy` | const | The default strategy: symmetric multi-objective Pareto significance. Ship iff |
| `SEARCH_LEDGER_SCHEMA` | const | Durable append-only audit log for improvement searches. |
| `FileSearchLedger` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `FsLabeledScenarioStore` | class | Filesystem `LabeledScenarioStore`: appends one JSONL file per source with provenance and |
| `LabeledScenarioStoreError` | class | Typed rejection from a labeled-scenario store (bad provenance, rate limit, invalid sample args) — carries a stable string `code`. |
| `ProfileMatrixError` | class | Thrown when the matrix is misconfigured (no profiles, a profile whose model |
| `SearchLedgerConflictError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `SearchLedgerError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `SearchLedgerIntegrityError` | class | _(no summary — add a TSDoc line at the declaration)_ |
| `WorktreeAdapterError` | class | Typed failure from a `WorktreeAdapter` operation (create/finalize/discard) — wraps the underlying git error as `cause`. |
| `AnalystArtifact` | interface | The analyst's output for one scenario — the artifact the judge scores. |
| `AnalystScenario` | interface | A labeled trace scenario: a FIXED trace corpus plus the failure modes a |
| `CampaignArtifactWriter` | interface | Scoped artifact writer — `write(path, content)` lands under |
| `CampaignCellFailureReceipt` | interface | Durable `<cell>/failure-receipt.json` written before a failed cell can |
| `CampaignCostMeter` | interface | Cell-scoped paid-call entry point. The dispatch places every paid operation |
| `CampaignScenarioIdentity` | interface | Redacted identity of a complete scenario payload retained in campaign results. |
| `CampaignStorage` | interface | `CampaignStorage` — the filesystem seam `runCampaign` writes through |
| `CampaignTraceWriter` | interface | Scoped trace writer handed to each dispatch — every span |
| `CodeSurface` | interface | A tier-4 code surface — a finalized candidate change to the agent's |
| `ComparisonCost` | interface | Cost reported by a method or by final test scoring. |
| `ComponentSurface` | interface | Named text components optimized together as one candidate. |
| `CrossSurfaceCandidate` | interface | Immutable identity for a single candidate or a materialized composition. |
| `CrossSurfaceComponent` | interface | One independently proposed change on one caller-defined surface. |
| `CrossSurfaceComponentEvidence` | interface | Per-component trace evidence captured during one task attempt. |
| `CrossSurfaceInteractionPath` | interface | One deterministic growth path starting from a compatible two-surface seed. |
| `CrossSurfaceSelectionPolicy` | interface | Predeclared candidate eligibility and composition policy. |
| `CrossSurfaceTaskRow` | interface | Canonical per-task input row. Consumers may extend this interface with |
| `DispatchContext` | interface | Context handed to every dispatch invocation. Scoped — every |
| `ExternalTextOptimizationMethodConfig` | interface | Configuration for adapting another text optimizer. |
| `FsLabeledScenarioStoreOptions` | interface | Filesystem `LabeledScenarioStore` adapter. The default capture sink for |
| `Gate` | interface | Composable promotion gate. |
| `GenerationCandidate` | interface | One scored candidate surface in a generation. `dimensions` + `scenarios` |
| `GepaEngineOptions` | interface | Shared settings for one bounded GEPA engine invocation. |
| `GepaEngineRun` | interface | One independently budgeted GEPA engine invocation. |
| `JudgeConfig` | interface | Pluggable dimensional scorer. `score` is the contract: |
| `JudgeScore` | interface | The canonical judge verdict shape — one declaration, shared by campaign |
| `LabeledScenarioWrite` | interface | Required-provenance write. The store rejects writes that |
| `LoopProvenanceCandidate` | interface | Loop provenance — the durable, queryable record of WHAT a self-improvement |
| `LoopProvenanceRecord` | interface | The durable provenance record. Aligns to the hosted `EvalRunEvent` path but |
| `OpenAICompatibleOptimizerModel` | interface | One metered OpenAI-compatible model connection shared by official optimizers. |
| `OpenAutoPrOptions` | interface | `openAutoPr` — thin shell-out helper for the `runImprovementLoop` preset's |
| `OptimizationMethod` | interface | A complete optimization method, including candidate generation and selection. |
| `OptimizationMethodInput` | interface | Shared inputs for one optimization method. Final test data is absent. |
| `PairedHoldout` | interface | Statistical held-out promotion machinery — the trustworthy core the |
| `ParetoParent` | interface | A non-dominated parent on the GEPA Pareto frontier — a |
| `PlaybackContext` | interface | Dispatch context plus the profile under test (which cheap model, etc.). |
| `PlaybackDriver` | interface | Drives the real product through a story and returns the runtime event stream |
| `PlaybackStep` | interface | One step of a user story — what the user does. The driver interprets |
| `PowerPreflightOptions` | interface | Power preflight — "can this budget detect the effect you are hunting?" |
| `PremeasuredOptimizationBaseline` | interface | `runOptimization` runs a caller-owned candidate generator for a bounded |
| `ProposalTrackContext` | interface | The lineage track that requested a proposal. |
| `ProposeContext` | interface | Everything a proposer may read to plan the next |
| `ProposedCandidate` | interface | A proposer output carrying the surface AND the WHY behind |
| `RolloutCall` | interface | One tool/action call observed in a rollout: a name plus its arguments. |
| `RunCampaignOptions` | interface | `runCampaign` — Pass A substrate primitive. ONE function that orchestrates |
| `RunEvalOptions` | interface | `runEval` — the simplest preset over `runCampaign`. No optimizer, no |
| `Scenario` | interface | Stable identifier + kind tag for any scenario. Consumers |
| `ScenarioSignal` | interface | Per-scenario observation: the composite scores each candidate earned on it. |
| `ScoreboardRow` | interface | One row of the launch scoreboard — story × requirement → PASS/FAIL. |
| `ScoreboardSummary` | interface | Launch-readiness headline counts rolled up from the per-requirement rows. |
| `ScoredRollout` | interface | A scored rollout: its calls plus the scalar outcome used to split pass/fail. |
| `ScoredSurfaceOutcome` | interface | Exact measured state for the surface an optimizer is learning from. |
| `SearchArtifactRef` | interface | Content-addressed artifact or receipt. Mutable paths are locators only; the |
| `SearchSourceRef` | interface | Repository, dataset, or package source pinned to an immutable commit or |
| `SearchSurfaceEvidence` | interface | Per-attempt proof that a declared candidate surface was or was not active, |
| `SessionScript` | interface | One session within a multi-session journey. Dispatch is |
| `SingleRunLockOptions` | interface | Single-run lock for evaluations that share one mutable environment. |
| `SurfaceProposer` | interface | A surface-improvement strategy. Given the current best |
| `TransientFailureOptions` | interface | Transient-transport-failure classification for dispatch retry policies. |
| `UserStory` | interface | A user story = a runnable product journey plus the requirements that define |
| `UserStoryVerdict` | interface | A scored user story — the completion verdict plus its human title. |
| `AxisVerdict` | type | Per-axis verdict from the good-direction paired bootstrap. |
| `CampaignTokenUsage` | type | Token usage accumulated for a cell. Aliased to the canonical `RunTokenUsage` |
| `CostLedgerHandle` | type | Public callback surface for a shared cost ledger. |
| `CrossSurfaceAttemptCompleteness` | type | Whether one candidate attempt produced a usable executable outcome. |
| `DefaultProductionGateCheck` | type | `defaultProductionGate` — composes the substrate's existing safety |
| `DispatchFn` | type | One function: scenario + ctx → artifact. Dispatcher chooses |
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
| `RunImprovementLoopOptions` | type | Run a caller-owned candidate generator, compare its winner with the starting |
| `SequentialDecision` | type | Anytime-valid sequential promotion gate — an e-process (betting |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AnalyzeCrossSurfaceInteractionsInput`, `AxisEvidence`, `BuildAnalystSurfaceDispatchOptions`, `BuildEvidenceVectorOptions`, `BuildLoopProvenanceArgs`, `CampaignAggregates`, `CampaignBreakdown`, `CampaignCellResult`, `CampaignResult`, `CampaignRunPlan`, `CampaignRunPlanCell`, `CodeSurfaceVerification`, `CompareOptimizationMethodsOptions`, `CrossSurfaceAdditionDecision`, `CrossSurfaceBestSingleSelection`, `CrossSurfaceBootstrapPolicy`, `CrossSurfaceCandidateComparison`, `CrossSurfaceCandidateEvidence`, `CrossSurfaceCandidateOutcome`, `CrossSurfaceCandidateSummary`, `CrossSurfaceCompositionStep`, `CrossSurfaceDistribution`, `CrossSurfaceEligibility`, `CrossSurfaceEvidenceBreakdown`, `CrossSurfaceInteractionAwareSelection`, `CrossSurfaceInteractionEffect`, `CrossSurfaceInteractionReport`, `CrossSurfaceInteractionTask`, `CrossSurfaceNaiveStackSelection`, `CrossSurfacePairCompatibility`, `CrossSurfacePairEvidence`, `CrossSurfacePairwiseEntry`, `CrossSurfaceRankedSingle`, `CrossSurfaceRelativeCost`, `CrossSurfaceSelections`, `DefaultProductionGateOptions`, `DimensionRegression`, `DiscriminationScore`, `EmitLoopProvenanceArgs`, `EmitLoopProvenanceResult`, `EvalFixture`, `EvalFixtureFile`, `EvalFixtureLoadOptions`, `EvalFixtureScenario`, `EvidenceVector`, `ExternalOptimizationExample`, `ExternalTextEvaluationResponse`, `ExternalTextOptimizerContext`, `ExternalTextOptimizerResult`, `FailureModeRecallJudgeOptions`, `GateContext`, `GateContribution`, `GateResult`, `GenerationRecord`, `GepaOptimizationMethodConfig`, `GitWorktreeAdapterOptions`, `HeldOutGateOptions`, `HeldoutSignificance`, `HeldoutSignificanceOptions`, `JudgeAggregate`, `JudgeDimension`, `LabeledScenarioRecord`, `LabeledScenarioSampleArgs`, `LabeledScenarioStore`, `LlmJudgeOptions`, `LoadEvalFixtureScenariosOptions`, `LoopProvenanceArgsFromResult`, `LoopProvenanceBackend`, `LoopProvenanceEvidence`, `LoopProvenanceOptimizationMethod`, `NeutralizationGateOptions`, `OpenAutoPrResult`, `OpenSearchLedgerOptions`, `OptimizationMethodComparison`, `OptimizationMethodPairwise`, `OptimizationMethodProvenance`, `OptimizationMethodResult`, `OptimizationMethodScore`, `OptimizationPackageSource`, `OptimizationTokenUsage`, `OptimizerConfig`, `ParetoSignificanceGateOptions`, `PendingCostCallView`, `PlanCampaignRunOptions`, `PlanEvalFixtureRunOptions`, `PowerPreflight`, `ProfileSummary`, `PromotionObjective`, `ReferenceEquivalenceJudgeOptions`, `ReferenceEquivalenceScenario`, `RolloutArgumentDiff`, `RolloutArgumentDiffOptions`, `RunImprovementLoopResult`, `RunOptimizationResult`, `RunProfileMatrixOptions`, `RunProfileMatrixResult`, `ScenarioAggregate`, `ScenarioRollup`, `ScoreboardRenderOptions`, `SearchAttemptAccounting`, `SearchCandidateDecidedEvent`, `SearchCandidateLineage`, `SearchCandidateRegisteredEvent`, `SearchCandidateSlot`, `SearchCandidateSlotClosedEvent`, `SearchCandidateSurface`, `SearchCompletedEvent`, `SearchFailureReason`, `SearchLedger`, `SearchLedgerAppendResult`, `SearchLedgerEntry`, `SearchLedgerReplay`, `SearchModelIdentity`, `SearchOperationRecordedEvent`, `SearchPlan`, `SearchPlannedEvent`, `SearchPlannedOperation`, `SearchPlannedTask`, `SearchTaskAttemptedEvent`, `SequentialDecideFn`, `SequentialDecideOptions`, `SequentialObservation`, `SequentialPairedGate`, `SequentialPairedGateOptions`, `SingleRunLock`, `SkillOptOptimizationMethodConfig`, `SkillOptTrainerConfig`, `TraceSpan`, `UngroundedLiteralReport`, `Worktree`, `WorktreeAdapter`, `CrossSurfaceAdditionRejectionReason`, `CrossSurfaceIneligibilityReason`, `CrossSurfacePairIncompatibilityReason`, `DefaultProductionRewardHackingOptions`, `EvalFixtureRunPlan`, `EvalFixtureValidationMode`, `OptimizerModelBudget`, `RedactionStatus`, `RunOptimizationOptions`, `SearchAccountingAudit`, `SearchCostAccounting`, `SearchLedgerEvent`, `SearchLedgerHash`, `SearchOperationKind`, `SearchSurfaceEffect`, `SearchSurfaceKind`, `SearchTaskOutcome`, `SearchTokenAccounting`, `SkillOptRunnerCommand`.

### TOKEN / USAGE — usage extraction + run-record usage types

Import from `@tangle-network/agent-eval` — 5 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `extractUsage` | function | Pull `{ input, output, cached?, cacheWrite? }` from a parsed response |
| `extractUsageFromResponse` | function | Extract usage from an HTTP `Response` without consuming the caller's body: |
| `extractUsageFromSse` | function | Extract token usage from a complete SSE response body using the shared SSE |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `LlmUsage`, `RunTokenUsage`.
