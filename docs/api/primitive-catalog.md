<!--
  GENERATED — do not edit. Run `pnpm run docs:api` to regenerate.
  Source: scripts/gen-primitive-catalog.mjs reads the LIVE exports of this
  package + the @tangle-network/agent-eval substrate via the TypeScript compiler.
  A live export missing here = a RED BUILD (scripts/check-docs-freshness.mjs).
-->

# Primitive catalog — the never-stale anti-reinvention inventory

> **GENERATED** from `@tangle-network/agent-runtime@0.128.1` and `@tangle-network/agent-eval@0.144.1` by `scripts/gen-primitive-catalog.mjs`. Do NOT hand-edit — run `pnpm run docs:api`. This is the mechanical companion to the JUDGMENT in `canonical-api.md` (§2 decision table + §1.5 AgentProfile law): that doc says WHICH primitive to reach for and what NOT to build; this catalog proves WHAT exists. Per-symbol signatures + `file:line` live in the per-module pages under `docs/api/`.

## 1. agent-runtime — own public surface

Every subpath this package declares in `package.json` `exports`. Reach for these before hand-rolling a loop, driver, conversation runner, optimizer wrapper, or observability shim.

### Root — task lifecycle, conversation, RSI verbs, observability

Import from `@tangle-network/agent-runtime` — 407 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `agentCandidateProfileAsAgentProfile` | function | Convert the candidate profile contract into the portable interface profile it represents. |
| `agenticGenerator` | function | Full-agentic `CandidateGenerator` (the `shots=N, sandbox=on` setting): run a real coding harness inside the candidate worktree so the agent makes the change in place. |
| `applyExactAgentProfileDiff` | function | Apply one exact diff and reject any value that cannot be preserved canonically. |
| `applyRolloutPolicyToProfile` | function | Persist a detached policy under the profile extension without mutating the input. |
| `applyRunRecordDefaults` | function | Stamp cross-cutting defaults onto adapter-projected RunRecords without |
| `assertCandidateProfileBinding` | function | Prove the measured generic profile and sealed candidate profile describe the same behavior. |
| `auditLoopRunner` | function | `audit` mode — analyst loop over captured trace/run data. |
| `buildAgentCandidateBundle` | function | Compile one measured profile/code candidate into the immutable execution |
| `buildForwardHeaders` | function | Build the headers to emit on an outbound participant call, given the |
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
| `computeBackoff` | function | Compute the delay before the next attempt. Default: 250ms exponential with jitter. |
| `createAgentCandidateWorkspacePort` | function | Create the standard bounded materializer for candidate execution ports. |
| `createAgentKnowledgeReadinessCheck` | function | Build the default readiness check backed by `@tangle-network/agent-knowledge` validation and scoring. |
| `createConversationBackend` | function | Adapt a multi-participant conversation into the standard execution backend contract. |
| `createIterableBackend` | function | Wrap any custom async-iterable stream into a typed `AgentExecutionBackend`. |
| `createKnowledgeImprovementActivationExecutor` | function | Apply or restore one local knowledge candidate through the shared activation contract. |
| `createOpenInferenceFileExporter` | function | Create an exporter that APPENDS spans to a local OpenInference-JSONL file, one complete span per |
| `createOtelExporter` | function | Create an OTEL exporter. Returns undefined when no endpoint is configured. |
| `createProtectedAgentCandidateModelPort` | function | Bind a protected model-grant service to the immutable candidate runtime. |
| `createRuntimeEventCollector` | function | Build an in-memory collector that sanitizes and accumulates `AgentRuntimeEvent`s for inspection. |
| `createRuntimeStreamEventCollector` | function | Streaming-event counterpart of `createRuntimeEventCollector`. Pass each |
| `createSandboxPromptBackend` | function | Build an `AgentExecutionBackend` backed by a sandbox/sidecar `streamPrompt` call. |
| `createSupervisedKnowledgeUpdater` | function | Create an `improveKnowledgeBase` update callback backed by runtime supervision. |
| `d1ToSqlAdapter` | function | Adapt a Cloudflare D1 binding to the SqlAdapter shape. Lives here so D1 |
| `decideKnowledgeReadiness` | function | Map a `KnowledgeReadinessReport` to a three-state branch (`ready` / `blocked` / `caveat`) the runtime, route handlers, and UI shells all switch on. |
| `defaultBuildPrompt` | function | Turn proposal findings into a concrete coder task — |
| `defineConversation` | function | Validate and define a conversation before execution. |
| `defineRuntimeHooks` | function | Identity helper that types a {@link RuntimeHooks} literal so the fields are inferred. |
| `disposePreparedAgentCandidateExecution` | function | Revoke reservations held by a prepared candidate that will not be executed. |
| `driverLoopGenerator` | function | Driver→worker `CandidateGenerator`: an LLM driver on the canonical tool-loop authors, observes, rates, and steers coding-harness sessions in the worktree until the verifier passes or the session budge |
| `exactProcessProviderAsCandidateExecutor` | function | Adapt one neutral exact-process provider to Runtime's trusted candidate boundary. |
| `executePreparedAgentCandidate` | function | Executes and finalizes one durably claimed candidate without exposing an unproven result. |
| `exportEvalRuns` | function | Ship self-improvement eval-run events to Tangle Intelligence. Unlike the |
| `findingLines` | function | Render findings as the ranked-evidence block every build prompt ends with. |
| `formatSupervisedKnowledgeTask` | function | Format the supervisor task with the KB root, readiness requirements, current findings, and metadata. |
| `freezeGenericAgentCandidateProfile` | function | Convert only behavior-preserving generic profile fields into the closed candidate contract. |
| `generateSpanId` | function | Mint a fresh 16-hex-character OTLP span id. Exported so a producer that must know a span's id |
| `getModels` | function | Fetch the model catalog from the router's `/v1/models`. Throws on a non-2xx |
| `improve` | function | Optimize one exact profile surface with a complete method. |
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
| `officialGepa` | function | Build a complete method backed by GEPA's official Optimize Anything API. |
| `officialSkillOpt` | function | Build a complete method backed by Microsoft's official SkillOpt trainer. |
| `omitUndefinedObjectFields` | function | Recursively remove undefined object fields while refusing undefined array entries. |
| `padSpanId` | function | Map a caller-supplied span id onto the 16-hex OTLP encoding. An id that is already a valid W3C |
| `padTraceId` | function | Trace-id counterpart of {@link padSpanId}: valid W3C trace ids pass through (dash-stripped when |
| `parseExactAgentProfile` | function | Parse a complete profile without silently discarding unsupported fields. |
| `parseExactAgentProfileDiff` | function | Parse a profile diff without silently discarding unsupported fields. |
| `parseExactCandidateProfile` | function | Parse a candidate profile without silently discarding unsupported or non-canonical fields. |
| `parseLoopRunnerArgv` | function | Parse `--mode X --config Y` from an argv tail (`process.argv.slice(2)`). |
| `parseRolloutPolicy` | function | Parse a serialized policy surface. Returns `undefined` for non-strings, |
| `persistCandidateOutputArtifact` | function | Persist evaluator evidence, read it back, and bind the returned locator to the exact bytes. |
| `prepareAgentCandidateExecution` | function | Materializes a verified candidate into one immutable evaluator-owned execution plan. |
| `rawTraceDistiller` | function | Build an `analyzeGeneration` producer that feeds the proposer RAW-TRACE |
| `readDepth` | function | Read the depth counter off an inbound request. Missing → 0 (caller is the |
| `readinessServerSentEvent` | function | Serialize a `KnowledgeReadinessReport` as a Server-Sent Event string. |
| `recoverExpiredAgentCandidateExecution` | function | Close an expired crashed attempt from persisted non-secret handles, then record failure. |
| `reflectiveGenerator` | function | Cheap no-sandbox `CandidateGenerator` (the `shots=1` setting): draft surface edits via the improvement adapter and apply them as one coherent candidate. |
| `researchLoopRunner` | function | `research` mode — research-in-a-loop with valid-only KB growth. |
| `resolveChatModel` | function | Resolve a chat model by precedence: the first candidate carrying a |
| `resolveRouterBaseUrl` | function | Resolve the router base URL from env, normalised — no trailing `/v1` or `/`. |
| `runAgentTask` | function | Single-shot task lifecycle for adapter-driven tasks: readiness-gated, emits the runtime lifecycle event vocabulary, session-store pluggable. |
| `runAgentTaskStream` | function | Streaming task lifecycle: delegates execution to an `AgentExecutionBackend` (model API, sandbox, or custom iterable) and yields lifecycle events as they happen. |
| `runConversation` | function | Run a conversation to completion and return its terminal result. |
| `runConversationStream` | function | Streaming conversation orchestrator: drives N participants in turn through their own backends, enforcing `maxTurns` / `maxCreditsCents` / `haltOn`, yielding per-event stream markers. |
| `runDelegatedLoop` | function | Dispatch a configured loop by mode. Fails loud (throws `ConfigError`) when no |
| `runKnowledgeImprovementJob` | function | Produce a frozen KB candidate while leaving live knowledge content unchanged. |
| `runLoopRunnerCli` | function | Pure CLI core (no process / argv / IO) so it's unit-testable: validate the |
| `runPersonaConversation` | function | Run one worker profile against one persona as a multi-round conversation. |
| `runPersonaDispatch` | function | Wrap {@link runPersonaConversation} as a `ProfileDispatchFn` for |
| `runSupervisedKnowledgeUpdate` | function | Run a runtime supervisor that updates one candidate knowledge base and stops on readiness. |
| `runtimeStreamServerSentEvent` | function | Serialize a `RuntimeStreamEvent` as a Server-Sent Event string. |
| `sanitizeAgentRuntimeEvent` | function | Reduce an `AgentRuntimeEvent` to a PII-safe, serializable plain object for telemetry. |
| `sanitizeKnowledgeReadinessReport` | function | Strip PII and large blobs from a `KnowledgeReadinessReport` for safe telemetry emission. |
| `sanitizeRuntimeStreamEvent` | function | Reduce a `RuntimeStreamEvent` to a PII-safe, serializable plain object for telemetry. |
| `sealAgentCandidateBundle` | function | Validate and content-address a candidate bundle before it crosses an approval boundary. |
| `serializeRolloutPolicy` | function | Stable serialization with fixed field order. |
| `sleep` | function | Resolve after `ms` milliseconds — used for retry backoff in conversation call policy. |
| `slugifySpeaker` | function | Reduce a speaker name to ASCII alphanumerics + dashes. Preserves enough |
| `startRuntimeRun` | function | Construct a runtime-run handle. The returned handle is mutable across its |
| `structuralRolloutPolicyFromProfile` | function | Read the persisted policy off the profile. `undefined` when the profile does |
| `toolBuildPrompt` | function | Build the starting instruction for a coder agent tasked with implementing a new tool. |
| `toOtelAttributes` | function | Convert a flat record into the OTLP attribute list. Non-finite numbers are DROPPED (an OTLP |
| `turnId` | function | Deterministic turn identifier. Stable across retries of the same logical |
| `validateChatModelId` | function | Validate a caller-supplied chat-model id. Rejects non-strings, malformed |
| `verifyAgentCandidateBundle` | function | Verifies every digest, resource, workspace, and Git object in a candidate bundle. |
| `worktreeLoopRunner` | function | `code` mode on the GENERIC recursive path: author one `AgentProfile` per harness, run them as a |
| `AGENT_CANDIDATE_EXECUTION_SUPPORT` | const | Surfaces admitted by Runtime's verifier before an environment adapter is selected. |
| `AGENTIC_PROFILE_RESOURCE_ROOT` | const | Dedicated ephemeral root for generic author-profile files. Every declared |
| `buildDriverSystem` | const | The driver's stance for `driverLoopGenerator` — the build-domain instance of |
| `CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV` | const | Environment variable containing the materialized retrieval configuration path. |
| `CANDIDATE_KNOWLEDGE_ROOT_ENV` | const | Environment variable containing the materialized candidate knowledge root. |
| `CANDIDATE_TRACE_ENV` | const | Environment keys used to propagate immutable candidate trace identity. |
| `CANDIDATE_TRACE_TAGS` | const | Protected trace tags that bind a run to one prepared candidate execution. |
| `DEFAULT_MAX_DEPTH` | const | Hard cap on chained gateway hops; refused beyond this. Default keeps recursion bounded. |
| `DEFAULT_ROUTER_BASE_URL` | const | Default Tangle Router base URL used when no env override is set. |
| `defaultIsRetryable` | const | Default retryable classification — network/timeout class errors. Errors |
| `DELEGATED_LOOP_MODES` | const | All valid delegated-loop mode names — used for validation and CLI surfaces. |
| `FORWARD_HEADERS` | const | Standard names — lowercased so Headers maps interop on every runtime. |
| `INTELLIGENCE_WIRE_VERSION` | const | Wire version the eval-runs ingest enforces (X-Tangle-Wire-Version + body). |
| `optimizerMethod` | const | The shared method block every build/author prompt embeds. Domain framing |
| `RESEARCH_SUPERVISOR_SYSTEM_PROMPT` | const | Standing prompt for a supervisor that grows a shared knowledge base through spawned researchers. |
| `researchDriverNote` | const | The driver's ADOPT-not-build doctrine, appended to `buildDriverSystem` when |
| `ROLLOUT_POLICY_EXTENSION` | const | The profile extensions namespace the policy persists under. |
| `strategyAuthorMethod` | const | The senior authoring process for `authorStrategy` — the same method, shaped |
| `AgentEvalError` | class | Base class for every contract error this package throws — carries the stable |
| `BackendTransportError` | class | A backend transport call (HTTP, gRPC, sidecar IPC) failed with a non-success |
| `CircuitBreakerState` | class | Live circuit-breaker state — one instance per (participant, conversation run). |
| `CircuitOpenError` | class | Thrown when the circuit breaker is open for a participant and no retry is allowed yet. |
| `ConfigError` | class | Configuration missing or malformed (`HOME` unset, required image not supplied, env var absent). |
| `DeadlineExceededError` | class | Thrown when a backend call exceeds its per-attempt deadline. |
| `FileAgentCandidateExecutionClaimStore` | class | Cross-process lifecycle implemented as fsynced, create-if-absent records. |
| `FileConversationJournal` | class | JSONL on disk. One line per record; first line is the `begin`, subsequent |
| `InMemoryAgentCandidateExecutionClaimStore` | class | Single-process lifecycle implementation. |
| `InMemoryConversationJournal` | class | In-memory `ConversationJournal` — suitable for testing and single-process runs. |
| `InMemoryRuntimeSessionStore` | class | In-memory `RuntimeSessionStore` for single-process use and tests. |
| `JudgeError` | class | A judge call failed in a way that's not retryable: schema parse failure, bad rubric, conflicting dimensions. |
| `NotFoundError` | class | A named resource (run, span, rubric, scenario, dataset row, route) does not exist. |
| `OfficialOptimizerUnavailableError` | class | Missing optional Python dependencies for an official optimizer. |
| `PlannerError` | class | The dynamic-loop planner returned an unusable topology move — the LLM emitted |
| `RuntimeRunStateError` | class | A runtime-run lifecycle method was called in an order the state machine does |
| `SqlConversationJournal` | class | SQL-backed ConversationJournal. Two tables — runs (one row per runId, holds |
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
| `AgentSpec` | interface | `AgentProfile` is the complete execution authority. Scope parses and snapshots it before calling |
| `BackendErrorDetail` | interface | Typed transport / backend failure detail. Carried on `backend_error` and |
| `Budget` | interface | A budget envelope on a spawn or the root. All ceilings; the pool reserves against them. |
| `BuildAgentCandidateBundleInput` | interface | Complete measured surfaces and execution policy compiled into one candidate bundle. |
| `BuildPromptFindingsInput` | interface | Evidence supplied to a generated tool or MCP build instruction. |
| `CandidateGenerator` | interface | The byte-producing path that differs between the cheap |
| `CircuitBreakerConfig` | interface | Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`. |
| `D1DatabaseLike` | interface | Structural type matching the surface of `D1Database` we depend on, so the |
| `Executor` | interface | The leaf runtime — ONE open interface, not a closed union. `execute` returns a |
| `ExecutorRegistry` | interface | The OPEN resolver maps an already-admitted `AgentSpec` to an `ExecutorFactory`. Scope validates |
| `FinalizeContext` | interface | What a finalizer gets to decide with. `delivered` is the ONLY output material; `allSettled` |
| `ImproveCandidateValidationInput` | interface | Exact materialized profile presented for validation before any candidate run. |
| `ImproveCost` | interface | Normalized spend reported for one Runtime improvement run. |
| `ImproveLineage` | interface | Optimizer ancestry sealed into downstream candidate experiments. |
| `ImproveMethodLineage` | interface | Method optimization always retains every identity needed to reject task reuse. |
| `ImproveProfileComponents` | interface | Caller-owned mapping for optimizing several profile fields as one candidate. |
| `ImproveScenarioPartitions` | interface | Redacted task evidence retained for every optimizer-visible partition. |
| `LoopSpanNode` | interface | Sink-neutral node in a reconstructed loop span tree. The root node's |
| `ModelInfo` | interface | A model entry as returned by the Tangle Router `/v1/models` endpoint. |
| `OfficialOptimizerContextOptions` | interface | Runtime context appended to an official optimizer's own configuration. |
| `OpenAIChatTool` | interface | OpenAI Chat Completions tool descriptor. The shape mirrors the |
| `PreparedAgentCandidateKnowledge` | interface | Exact file-backed knowledge admitted by the candidate bundle. |
| `RouterEnv` | interface | Env keys the router base URL is resolved from. |
| `RunRecord` | interface | Mandatory paper-grade fields for a single evaluation run. Optional |
| `RuntimeHooks` | interface | The observation seam attached to a running loop (never to the portable genome). |
| `Scope` | interface | The budget-conserving reactive scope an `Agent.act` runs inside. `spawn` reserves |
| `Spend` | interface | Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd |
| `SqlAdapter` | interface | Minimal SQL driver shape. Implementations forward to whichever client the |
| `Supervisor` | interface | Owns the conserved pool, the spawn log, the abort cascade, the OTP intensity breaker, |
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
| `CoordinationEvent` | type | Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for |
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
| `PersistedTaskOutcomeEvidence` | type | Immutable evaluator evidence retained with a verified candidate task outcome. |
| `PersonaDriver` | type | A persona that drives the conversation: either a full driver `AgentProfile` |
| `PropagatedHeaders` | type | Header bag carried through `AgentBackendContext.propagatedHeaders` so |
| `ReadonlyAgentProfile` | type | Complete immutable profile value used during measured execution. |
| `RetryableErrorPredicate` | type | Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors. |
| `RetryBackoff` | type | Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`. |
| `RuntimeHookPhase` | type | Runtime hook contracts. Hooks are execution-scoped observers, not part of an |
| `Settled` | type | A settled child, delivered by `scope.next()`. `seq` is the monotonic cursor order |
| `SupervisedResult` | type | Typed terminal result (M2) — a no-winner is NEVER coerced to a best-effort output. |
| `SupervisorFinalizer` | type | The finalization seam: ledger in, output (or `undefined` = nothing deliverable) out. |
| `VerifiedAgentCandidateTaskOutcome` | type | Branded task outcome that has survived independent evaluator verification. |
| `Verifier` | type | Verifies the edited worktree. Sync or async; throws only on a setup fault |
| `WorkerTraceEvidence` | type | Durable proof of a worker's structured tool trace, or the exact reason it is unavailable. |
| `WorkerTraceUnavailableReason` | type | Why Runtime cannot provide structured tool-call evidence for one settled execution. |
| `WorktreeCheckRunner` | type | The single shell-command-in-worktree runner seam (replaces the per-executor copies). |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentAdapter`, `AgentBackendContext`, `AgentBackendInput`, `AgentCandidateContainerPort`, `AgentCandidateExecutionAttemptRef`, `AgentCandidateExecutionPorts`, `AgentCandidateExecutorWorkspaceFile`, `AgentCandidateExecutorWorkspaceInput`, `AgentCandidateMemoryPort`, `AgentCandidateMemoryResetResult`, `AgentCandidateModelPort`, `AgentCandidatePreparationEvidence`, `AgentCandidateProtectedModelActivation`, `AgentCandidateProtectedModelReservation`, `AgentCandidateProtectedModelSettlement`, `AgentCandidateProtectedRunCapture`, `AgentCandidateVerificationPorts`, `AgentCandidateWorkspaceArchiveLimits`, `AgentExecutionBackend`, `AgenticGeneratorOptions`, `AgenticGeneratorShotReceipt`, `AgentKnowledgeProvider`, `AgentKnowledgeReadinessCheckOptions`, `AgentTaskContext`, `AgentTaskRunResult`, `AgentTaskSpec`, `AnalystRegistry`, `BackendCallPolicy`, `CanonicalCandidateDocument`, `CaptureAgentCandidateWorkspaceOptions`, `CapturedAgentCandidateWorkspace`, `ChatModelCandidate`, `ControlBudget`, `ControlEvalResult`, `ControlRunResult`, `ControlStep`, `Conversation`, `ConversationDriveState`, `ConversationJournal`, `ConversationJournalEntry`, `ConversationParticipant`, `ConversationPolicy`, `ConversationResult`, `ConversationTurn`, `CreateAgentCandidateWorkspacePortOptions`, `CreateKnowledgeImprovementActivationExecutorOptions`, `CreateProtectedAgentCandidateModelPortOptions`, `D1StmtLike`, `DataAcquisitionPlan`, `DelegatedLoopResult`, `DisposePreparedAgentCandidateOptions`, `Driver`, `DriverLoopGeneratorOptions`, `EvalRunEvent`, `EvalRunGeneration`, `EvalRunsExportConfig`, `EvalRunsExportResult`, `ExactProcessCandidateExecutorOptions`, `ExecutePreparedAgentCandidateOptions`, `FileAgentCandidateExecutionClaimStoreOptions`, `HaltContext`, `HaltSignal`, `ImproveCodeOptions`, `ImproveCodeResult`, `ImprovementCodeCandidate`, `ImprovementProfileCandidate`, `ImproveMethodContext`, `ImproveMethodResult`, `ImproveSkillsOptions`, `InMemoryAgentCandidateExecutionClaimStoreOptions`, `KnowledgeImprovementActivationExecutor`, `KnowledgeImprovementCandidatePair`, `KnowledgeImprovementExperimentBundles`, `KnowledgeImprovementJobMeasurement`, `KnowledgeImprovementJobResult`, `KnowledgeReadinessCheckInput`, `KnowledgeReadinessDecision`, `KnowledgeReadinessReport`, `KnowledgeRequirement`, `LoopResult`, `LoopRunnerCliArgs`, `LoopRunnerCliResult`, `McpServeSpec`, `OfficialSensitiveCandidateInput`, `OtelAttribute`, `OtelExportConfig`, `OtelExporter`, `OtelSpan`, `PersonaConversationResult`, `PrepareAgentCandidateExecutionOptions`, `PreparedAgentCandidateExecution`, `PreparedAgentCandidateInstruction`, `PreparedAgentCandidateLaunch`, `PreparedAgentCandidateTrace`, `RawTraceDistillerOptions`, `RecoverExpiredAgentCandidateOptions`, `ReflectiveGeneratorOptions`, `ResearchLoopResult`, `ResearchLoopRunnerOptions`, `ResolvedAgentCandidateContainer`, `ResolvedChatModel`, `RunAgentTaskOptions`, `RunAgentTaskStreamOptions`, `RunConversationOptions`, `RunDelegatedLoopOptions`, `RunKnowledgeImprovementJobOptions`, `RunPersonaConfig`, `RunPersonaConversationOptions`, `RuntimeDecisionEvidenceRef`, `RuntimeDecisionPoint`, `RuntimeEventCollector`, `RuntimeEventOtelOptions`, `RuntimeHookContext`, `RuntimeHookErrorContext`, `RuntimeHookEvent`, `RuntimeRunCompleteInput`, `RuntimeRunCost`, `RuntimeRunHandle`, `RuntimeRunOptions`, `RuntimeRunPersistenceAdapter`, `RuntimeRunRow`, `RuntimeSession`, `RuntimeSessionStore`, `RuntimeStreamEventCollector`, `RuntimeStreamEventSummary`, `RuntimeTelemetryOptions`, `SanitizedKnowledgeReadinessReport`, `SanitizedKnowledgeRequirement`, `ServerSentEventOptions`, `SupervisedKnowledgeUpdateInput`, `SupervisedKnowledgeUpdateOptions`, `SupervisedKnowledgeUpdateResult`, `VerifiedAgentCandidate`, `VetoedFact`, `WorktreeLoopRunnerOptions`, `AgentCandidateModelGrantActivateInput`, `AgentCandidateModelGrantReserveInput`, `AgentCandidateModelGrantSettleInput`, `AgentCandidateOutputPurpose`, `AgentCandidateRetryRejection`, `AgentCandidateRunFinalization`, `AgentRuntimeEvent`, `AgentRuntimeEventSink`, `AgentTaskStatus`, `AuthSource`, `ChatModelValidation`, `ControlDecision`, `ConversationStreamEvent`, `DeepReadonly`, `DelegatedLoopMode`, `DelegatedLoopRegistry`, `DelegatedLoopRunner`, `ForwardHeaderName`, `HaltPredicate`, `HaltReason`, `ImproveCandidateValidator`, `ImprovementCandidate`, `ImproveMethodSource`, `ImproveOptimizationRunOptions`, `ImproveProfileSurface`, `ImproveResult`, `KnowledgeReadinessCheck`, `KnowledgeReadinessCheckResult`, `RuntimeDecisionKind`, `RuntimeHookTarget`, `RuntimeRunStatus`, `RuntimeStreamEvent`, `RuntimeStreamEventSink`, `SupervisedKnowledgeUpdater`, `TurnOrder`.

### Vertical agent — manifest + surface proposal source

Import from `@tangle-network/agent-runtime/agent` — 48 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `assertProfileMaterialization` | function | Throw when a candidate changes axes the selected run path cannot carry. |
| `collectAgentRun` | function | Drain `act`'s `events` into an array AND await its `output`. Useful for |
| `createSandboxAct` | function | Build an `AgentRuntime.act` implementation backed by a single prod-profile |
| `createSurfaceImprovementProposer` | function | Resolve each finding to a real surface and draft a detached patch candidate. |
| `defineAgent` | function | Construct a validated agent manifest. Throws `AgentManifestError` |
| `defineProfileMaterializationContract` | function | Define the profile axes a concrete run path actually carries into execution. |
| `profileMaterializationAxes` | function | Return every canonical profile leaf that contains a meaningful request. |
| `renderProfileMaterializationIssues` | function | Format profile-axis drop issues into a concise operator-facing error. |
| `renderSurfaceIssues` | function | Format a list of surface validation issues into a human-readable error string. |
| `resolveSubjectPath` | function | Resolve a parsed `FindingSubject` to the file path the substrate |
| `unimplementedAgentRun` | function | Stub for agents whose `runtime.act` is not yet wired to the substrate's |
| `validateProfileMaterialization` | function | Return every changed profile axis that the selected run path would drop. |
| `validateSurfaces` | function | Validate an `AgentSurfaces` map on disk — missing paths fail loud at `defineAgent` time instead of silently skipping self-improvement edits. |
| `AGENT_PROFILE_MATERIALIZATION_AXES` | const | The 29 canonical AgentProfile leaves that can affect one execution. |
| `controlProfileMaterialization` | const | Materialization contract for a raw process path that carries only control/identity fields. |
| `fullProfileMaterialization` | const | Materialization contract for a run path that executes every canonical AgentProfile leaf. |
| `promptControlProfileMaterialization` | const | Materialization contract for an injected inference function whose surrounding driver still |
| `promptModelProfileMaterialization` | const | Materialization contract for an intentionally limited prompt-and-model execution path. |
| `promptOnlyProfileMaterialization` | const | Materialization contract for a run path that only injects prompt text. |
| `promptResourceProfileMaterialization` | const | Materialization contract for a run path that injects prompt text plus inline resources. |
| `sandboxActProfileMaterialization` | const | Materialization contract for `createSandboxAct`. |
| `worktreeCliProfileMaterialization` | const | Materialization contract for a local coding CLI in an isolated git worktree. |
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
| `AgentProfileMaterializationAxis` | type | AgentProfile axis name, with `custom:<name>` reserved for caller-owned extensions. |
| `CanonicalAgentProfileMaterializationAxis` | type | Compatibility name used by runtimes that distinguish canonical axes. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentRubric`, `AgentRunContext`, `AgentRunInvocation`, `AgentRuntime`, `AnalystConfig`, `CreateSandboxActOptions`, `CreateSurfaceImprovementProposerOptions`, `DraftPatchInput`, `DraftPatchOutput`, `JudgeConfig`, `ResolvedSurface`, `RubricDimension`, `SurfaceImprovementEdit`, `KnownAgentProfileMaterializationAxis`.

### Multi-turn conversations

Import from `@tangle-network/agent-runtime/conversation` — 53 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `buildForwardHeaders` | function | Build the headers to emit on an outbound participant call, given the |
| `computeBackoff` | function | Compute the delay before the next attempt. Default: 250ms exponential with jitter. |
| `createConversationBackend` | function | Adapt a multi-participant conversation into the standard execution backend contract. |
| `d1ToSqlAdapter` | function | Adapt a Cloudflare D1 binding to the SqlAdapter shape. Lives here so D1 |
| `defineConversation` | function | Validate and define a conversation before execution. |
| `isDepthExceeded` | function | Refuse further forwarding when the inbound depth has reached the limit. |
| `makePerAttemptSignal` | function | Build a per-attempt AbortSignal linked to the parent signal AND fired when |
| `readDepth` | function | Read the depth counter off an inbound request. Missing → 0 (caller is the |
| `runConversation` | function | Run a conversation to completion and return its terminal result. |
| `runConversationStream` | function | Streaming conversation orchestrator: drives N participants in turn through their own backends, enforcing `maxTurns` / `maxCreditsCents` / `haltOn`, yielding per-event stream markers. |
| `runPersonaConversation` | function | Run one worker profile against one persona as a multi-round conversation. |
| `runPersonaDispatch` | function | Wrap {@link runPersonaConversation} as a `ProfileDispatchFn` for |
| `sleep` | function | Resolve after `ms` milliseconds — used for retry backoff in conversation call policy. |
| `slugifySpeaker` | function | Reduce a speaker name to ASCII alphanumerics + dashes. Preserves enough |
| `turnId` | function | Deterministic turn identifier. Stable across retries of the same logical |
| `DEFAULT_MAX_DEPTH` | const | Hard cap on chained gateway hops; refused beyond this. Default keeps recursion bounded. |
| `defaultIsRetryable` | const | Default retryable classification — network/timeout class errors. Errors |
| `FORWARD_HEADERS` | const | Standard names — lowercased so Headers maps interop on every runtime. |
| `CircuitBreakerState` | class | Live circuit-breaker state — one instance per (participant, conversation run). |
| `CircuitOpenError` | class | Thrown when the circuit breaker is open for a participant and no retry is allowed yet. |
| `DeadlineExceededError` | class | Thrown when a backend call exceeds its per-attempt deadline. |
| `FileConversationJournal` | class | JSONL on disk. One line per record; first line is the `begin`, subsequent |
| `InMemoryConversationJournal` | class | In-memory `ConversationJournal` — suitable for testing and single-process runs. |
| `SqlConversationJournal` | class | SQL-backed ConversationJournal. Two tables — runs (one row per runId, holds |
| `CircuitBreakerConfig` | interface | Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`. |
| `D1DatabaseLike` | interface | Structural type matching the surface of `D1Database` we depend on, so the |
| `SqlAdapter` | interface | Minimal SQL driver shape. Implementations forward to whichever client the |
| `PersonaDriver` | type | A persona that drives the conversation: either a full driver `AgentProfile` |
| `PropagatedHeaders` | type | Header bag carried through `AgentBackendContext.propagatedHeaders` so |
| `RetryableErrorPredicate` | type | Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors. |
| `RetryBackoff` | type | Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `BackendCallPolicy`, `Conversation`, `ConversationDriveState`, `ConversationJournal`, `ConversationJournalEntry`, `ConversationParticipant`, `ConversationPolicy`, `ConversationResult`, `ConversationTurn`, `D1StmtLike`, `HaltContext`, `HaltSignal`, `PersonaConversationResult`, `RunConversationOptions`, `RunPersonaConfig`, `RunPersonaConversationOptions`, `AuthSource`, `ConversationStreamEvent`, `ForwardHeaderName`, `HaltPredicate`, `HaltReason`, `TurnOrder`.

### Product chat turns — edge-safe streaming, persistence, and stable execution IDs

Import from `@tangle-network/agent-runtime/durable` — 8 exports.

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

Import from `@tangle-network/agent-runtime/tool-loop` — 12 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `runToolLoop` | function | Run the bounded tool loop and return the final text + every executed tool |
| `streamToolLoop` | function | Streaming bounded tool loop: yields each raw turn event (the caller maps + |
| `ToolLoopAssistantToolCall` | interface | One OpenAI-shaped tool-call entry carried on an assistant message. |
| `ToolCallOutcome` | type | Outcome of one tool dispatch — structurally compatible with a hub/integration |
| `ToolLoopMessage` | type | A message in the running conversation the loop sends to `streamTurn`. |
| `ToolLoopStopReason` | type | Why the loop stopped. `completed` = model finished naturally; `stuck-loop` = |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `RunToolLoopOptions`, `StreamToolLoopOptions`, `ToolLoopCall`, `ToolLoopResult`, `StreamToolLoopYield`, `ToolLoopEvent`.

### Intelligence SDK — Observe + provable-OFF billing

Import from `@tangle-network/agent-runtime/intelligence` — 166 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `agentImprovementProfileDiffs` | function | Derive the ordered profile patch that changes one executable profile into |
| `agentImprovementProfileSurfaceDigest` | function | Return the `Sha256Digest` of one profile surface using Runtime's canonical candidate digest. |
| `agentImprovementProfileSurfaceInput` | function | Return the canonical current-state input for one profile-deliverable improvement target. |
| `agentImprovementTargetProfileDiffs` | function | Replace one measured profile surface exactly, including array-valued resources. |
| `buildAgentImprovementActivationTargets` | function | Bind caller-owned target identities to the exact source state Runtime measured. |
| `compileEffort` | function | Compile resolved `EffortSettings` into the orchestration overrides above. Pure: same |
| `composeCertifiedProfile` | function | Compose a certified profile into a uniform `ResolvedSurface`. Additive over |
| `composeCertifiedProfileFromWire` | function | Lower a plane `CertifiedProfile` straight into a `ResolvedSurface` via |
| `composeCertifiedPrompt` | function | Fold the certified prompt surface (and any certified prompt-folding artifacts: |
| `createAgentImprovementActivation` | function | Authorize product-owned writes only after the exact candidate was measured and approved. |
| `createAgentImprovementActivationResult` | function | Create the exact result a product stores in the same transaction as its target write. |
| `createAgentImprovementMeasuredComparison` | function | Delegate all statistics and promotion checks to agent-eval's receipt-based comparison. |
| `createAgentImprovementProposal` | function | Create the reviewable record only from a complete, recomputable experiment result. |
| `createCertifiedPromptSource` | function | Create the cached certified-prompt source — the ONE module-scope-cache + |
| `createExactProcessCandidateExperimentExecutor` | function | Execute one signed experiment cell through any declared exact-process provider. |
| `createIntelligenceClient` | function | Create an Observe-mode Intelligence client. Resolves effort, the base URL, and |
| `createOptimizationActivationReceipt` | function | Build a detached receipt only for methods backed by an identified external optimizer. |
| `createProtectedExactProcessCandidateExperimentExecutor` | function | Compose host-owned execution ports with protected model access for one exact-process run. |
| `defaultRedactor` | function | The built-in redactor. Walks objects and arrays; replaces values under |
| `executeAgentCandidateExperimentCell` | function | Execute one exact arm, task, repetition, seed, and attempt through Runtime. |
| `executeAgentImprovementActivation` | function | Validate and execute one product-owned activation transition. |
| `isAgentImprovementProfileSurface` | function | Return whether a measured surface can be delivered through an agent profile. |
| `isAgentProfileMeasuredSurface` | function | Return whether a surface is eligible for shared profile measurement. |
| `isIntelligenceOff` | function | True when these settings admit NO intelligence spawn — the passthrough |
| `manifestFromProfile` | function | Lower the EXISTING plane wire (`CertifiedProfile`) into a `CapabilityManifest`. |
| `normalizeCertifiedProfile` | function | Deserialize the composed-endpoint response into a `CertifiedProfile`. The |
| `optimizationActivationReceiptFromMetadata` | function | Read and verify the optimizer evidence carried by a measured proposal. |
| `parseCandidateProfileMaterialization` | function | Parse and check every native file hash plus both canonical document digests. |
| `prepareAgentImprovementProfileActivation` | function | Compare product-owned profiles with an exact measured transition and prepare |
| `proposeAgentImprovement` | function | Analyze, search, then remeasure the resulting exact candidate before proposing it. |
| `proposeAgentProfileImprovement` | function | Analyze a product-owned profile, search one profile surface, then run the |
| `pullCertified` | function | Pull the certified composed profile for a target. Fail-closed: a network |
| `resolveEffort` | function | Compile a named tier (plus optional per-field overrides) into the flat |
| `resolveIntelligenceBaseUrl` | function | Resolve the ONE Intelligence base URL — the single knob both the send and |
| `resolveRedactor` | function | Resolve the redactor a client uses. A caller-supplied hook handles |
| `reviewAgentImprovementProposal` | function | Persist a human or tenant-policy decision bound to one exact proposal. |
| `runAgentCandidateExperiment` | function | Execute both arms of one immutable experiment and derive its paired result. |
| `submitAgentImprovementProposal` | function | Submit a completed Runtime proposal to Intelligence for product-side review. |
| `verifyAgentImprovementActivation` | function | Validate activation authority against the exact proposal, review, experiment, and base state. |
| `verifyAgentImprovementActivationResult` | function | Recompute one historical activation result against the exact measured proposal and authority. |
| `verifyAgentImprovementProposal` | function | Validate a proposal and recompute every binding to its measured experiment. |
| `verifyAgentImprovementReview` | function | Validate the canonical identity and wire shape of an improvement review. |
| `verifyCandidateExecutionEvidence` | function | Recheck one Runtime receipt against its exact signed experiment cell. |
| `withIntelligence` | function | Wrap an agent so it (a) RECEIVES the tenant's certified profile — the prompt |
| `AGENT_IMPROVEMENT_PROFILE_SURFACES` | const | Agent improvement surfaces delivered as exact `AgentProfileDiff` replacements. |
| `AGENT_PROFILE_MEASURED_SURFACES` | const | Profile changes eligible for the product-owned measured comparison path. |
| `defaultEffortTier` | const | The default tier when a client declares no effort. `'standard'` turns |
| `exactProcessCandidateExperimentExecutionSupport` | const | Candidate surfaces implemented by the neutral exact-process executor. |
| `AgentCandidateExperimentCellExecutionError` | class | A failed baseline or candidate cell with its complete Runtime failure result. |
| `CapabilityNotAdmittedError` | class | A binding kind whose resolver case is typed but not yet admitted (rag-index, |
| `AgentImprovementActivation` | interface | Authority receipt permitting activation of one already-measured candidate. |
| `AgentImprovementActivationResult` | interface | Immutable outcome of one idempotent, transaction-wide activation attempt. |
| `AgentImprovementMeasuredComparison` | interface | Portable paired held-out comparison produced by a sealed candidate executor. |
| `AgentImprovementReview` | interface | Human or tenant-policy decision bound to one exact proposal. |
| `AgentProfileImprovementBenchmark` | interface | Product-owned task material that Runtime freezes before either profile state runs. |
| `AgentProfileImprovementExecutor` | interface | One product execution adapter shared by optimizer search and exact profile |
| `AppliedIntelligence` | interface | What the hook hands the agent each run. Additive over the prompt-only |
| `CandidateExecutionEvidence` | interface | Complete execution of one exact experiment attempt. |
| `CandidateProfileMaterialization` | interface | Exact native profile files and the canonical plan that activated them. |
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
| `ProposedProfileDiff` | interface | A gate-certified profile diff the plane has already promoted, plus the |
| `ProtectedExactProcessCandidateExperimentExecutor` | interface | Exact-process executor plus the ports required for durable recovery. |
| `ProvisionedHost` | interface | A live, provisioned host the resolver tore up for a `process-on-infra` arm. |
| `RecordTraceMeta` | interface | Metadata for {@link IntelligenceClient.recordTrace}. |
| `RepoConfig` | interface | Repo coordinates a product may declare for the (later) Gated-PR mode. The |
| `ResolveCtx` | interface | Per-call, per-tenant context the resolver reads. Everything that touches the |
| `ResolvedHook` | interface | One resolved hook — event + the command/matcher the seam folds into |
| `ResolvedRetrieval` | interface | One retrieval handle. The agent never learns vector vs graph vs index. |
| `ResolvedSubagent` | interface | One resolved subagent — folded into `AgentProfile.subagents`. |
| `ResolvedSurface` | interface | What `composeCertifiedProfile` produces. Every binding fans into the same |
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
| `AgentImprovementEvaluation` | type | A reviewable measured result can come from a sealed executor or a normal profile executor. |
| `AgentImprovementExperimentMaterial` | type | Product-supplied experiment material. Runtime supplies optimizer ancestry and the final digest. |
| `AgentImprovementProfileStateDigest` | type | Product-defined hash of the complete profile state that actually runs. |
| `AgentImprovementProfileStateResolver` | type | Product-owned retained-state lookup used only for an explicit restore. |
| `AgentImprovementProposalSubmissionState` | type | What Runtime knows about a failed proposal submission. |
| `AgentProfileImprovementMethodOptions` | type | The portable profile changes that the measured-profile contract permits. |
| `CapabilityAuth` | type | How a binding authenticates at resolve time. Declared as a REQUIREMENT in the |
| `CapabilityInterface` | type | What the agent consumes. CLOSED — a new runtime kind NEVER extends this. Each |
| `CapabilitySurface` | type | Every interface surface tag — the closed set the resolver fans into slots. |
| `ContentRef` | type | Where a capability's bytes live. A leaked manifest carries no live secret and |
| `CorpusAccess` | type | Corpus access an intelligence tier permits. `'off'` reads and writes |
| `DeliveryBinding` | type | How a capability is backed. OPEN tagged union — THE extension point. All arms |
| `DeliveryBindingKind` | type | Every binding kind — the open set the resolver dispatches over. |
| `EffortOverrides` | type | Per-field overrides applied on top of a tier preset. Any subset of the |
| `EffortTier` | type | The named effort tiers, lowest to highest. `'off'` is the honest floor |
| `IntelligenceAgent` | type | An agent wrapped by {@link withIntelligence}: receives the input plus the |
| `IntelligenceWrapped` | type | The wrapped agent — same `(input) => Promise<output>` shape, plus a manual |
| `JsonSchema` | type | A JSON Schema object describing a tool's parameters. Kept structural — the |
| `PullOutcome` | type | Typed outcome for the pull — inspect `succeeded` before `value`. A 404 |
| `Redactor` | type | A redactor maps an arbitrary trace value to a safe-to-export value. Pure; |
| `SubmitAgentImprovementProposalOutcome` | type | Typed result for proposal submission. A successful result contains the |
| `UsageClass` | type | Usage class for billing. Base-stream tokens bill `'inference'`; every |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentCandidateExperimentCellPlacement`, `AgentImprovementActivationResultStore`, `AgentImprovementActivationTargetPlan`, `AgentImprovementProfileReplacement`, `AgentImprovementProfileStateDigestInput`, `AgentImprovementProfileStateResolverInput`, `AgentImprovementProposal`, `AgentImprovementTargetProfileDiffOptions`, `AgentProfileImprovementActivationTargetPlan`, `CreateAgentImprovementActivationOptions`, `CreateAgentImprovementActivationResultOptions`, `CreateAgentImprovementProposalOptions`, `CreateExactProcessCandidateExperimentExecutorOptions`, `ExactProcessCandidateExperimentExecution`, `ExactProcessCandidateExperimentExecutor`, `ExecuteAgentCandidateExperimentCellOptions`, `ExecuteAgentImprovementActivationInput`, `ExecuteAgentImprovementActivationOptions`, `OptimizationActivationReceipt`, `OptimizationReceiptCost`, `ProposeAgentImprovementOptions`, `ProposeAgentImprovementResult`, `ProposeAgentProfileImprovementResult`, `PullCertifiedOptions`, `ReviewAgentImprovementInput`, `RunAgentCandidateExperimentOptions`, `RunAgentCandidateExperimentResult`, `SealedCandidateActivationTransitionInput`, `VerifyCandidateExecutionEvidenceOptions`, `AgentImprovementActivationIntent`, `AgentImprovementActivationOutcome`, `AgentImprovementActivationTargetIdentity`, `AgentImprovementActivationTransitionInput`, `AgentImprovementAnalysisOptions`, `AgentImprovementProfileActivationInput`, `AgentImprovementProfileActivationPreparation`, `AgentImprovementProfileActivationTarget`, `AgentImprovementProfileSurface`, `AgentImprovementProfileTargetState`, `AgentImprovementProfileTargetTransition`, `AgentImprovementReviewDecision`, `AgentProfileImprovementActivationOperation`, `AgentProfileMeasuredSurface`.

### Execution kernel — recursive atom, supervision, executors, round-synchronous loop

Import from `@tangle-network/agent-runtime/kernel` — 712 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `acquireSandbox` | function | Cold-start-resilient sandbox acquisition: create by name, observe readiness from the sandbox's own status (not the create call), and re-attach after gateway timeouts. |
| `allOf` | function | Stop only when EVERY rule stops — for a conservative gate that needs corroboration. |
| `allWorkersStalled` | function | "Everyone is stuck." Fires when every live worker reads `stalled` — no metered activity for |
| `analyzeTrace` | function | Collect the source's spans and run the agent-eval batch analyzers over them under one `runId`. |
| `anyOf` | function | Stop when ANY rule stops — the ordinary composition (each rule is a separate reason to end). |
| `anytimeReport` | function | Derive anytime metrics from waterfall spans. `targets` are the satisficing score |
| `areaUnderCurve` | function | Mean of a best-so-far curve — the anytime AUC when the curve is normalized to [0,1]. Higher = |
| `asAuthoredProfile` | function | Narrow an untyped `spawn_agent` profile argument to an `AuthoredProfile`, or null if the |
| `assertCoordinationBinding` | function | Fail closed on a non-loopback coordination bind. `serveCoordinationMcp` mounts spawn_agent / |
| `assertModelAllowed` | function | Throw a `ConfigError` when `allowed` is set, `model` is defined, and `model` is not a |
| `assertProfileModelsAllowed` | function | Check every canonical model-bearing field in a complete profile, including the models a |
| `assertStrategyContract` | function | Static CONTRACT lint over an authored strategy module — the module-boundary |
| `assessAuthoredProfile` | function | OBSERVE one authored `AgentProfile` and score its richness (no judge verdict is read). The task |
| `auditIntent` | function | The route-rigor analyst: compare declared vs revealed vs user intent over a trajectory and return aligned / drifting / diverged with evidence and one recommended intervention. |
| `authorStrategy` | function | Author + load a strategy from losses. Throws when the author emits no loadable module; |
| `bestSoFar` | function | The best-so-far fold — the ONE definition of "how good was the run after k results", shared by |
| `breadthStrategy` | function | BREADTH: K independent rollouts (each own artifact), verifier picks the best. |
| `buildSteerContext` | function | Build the `SteerContext` a combinator reads to steer (its `loopUntil.until`, `widen` gate, any |
| `canDisplace` | function | The repair keep-best guard: a challenger displaces the incumbent only when it is |
| `canonicalFindingEvent` | function | Producer-side cleanliness for the `finding` event. The findings payload is arbitrary analyst |
| `captureWorkerTraceEvidence` | function | Collect and persist one executor's structured tool trace without changing its task outcome. |
| `chatTransportExecutor` | function | Build one exact profile-driven chat executor through `createExecutor`. |
| `chatWorkerSeam` | function | Session-owning worker factory for graph continuity. |
| `closingWorkerNote` | function | The worker's closing commentary off a local harness run: the TAIL of its |
| `collectAgentTurn` | function | Drain a `streamAgentTurn` stream (or any `RuntimeStreamEvent` stream that |
| `compareCheckOutcomes` | function | The selection order: crash < ran; then official pass-fraction; authored guesses only |
| `completionAuthorizes` | function | Decide whether a `CompletionVerdict` may end the node under the policy: authority scales with the verdict's determinism, and probabilistic verdicts must clear `minConfidence`. |
| `composeCheckSources` | function | Concatenate check sources (official first by convention — ordering does not affect |
| `composeWorkerEvidence` | function | Compose the settle evidence block. Section order is priority order under the |
| `computeFindingId` | function | Compute the stable finding_id from the identity-defining fields. |
| `connectStdioMcp` | function | Spawn a trusted host command, complete the stdio MCP handshake, and return |
| `contentAddress` | function | Stable content address shared by result and trace artifacts. |
| `copyUntrackedIntoClone` | function | Copy every untracked file of `sourceDir`'s working tree — including git-ignored |
| `createActivityLog` | function | Create a bounded activity ring. `limit` caps memory for a worker that runs thousands of tools. |
| `createAgentEnvironmentProviderRegistry` | function | Create a registry that resolves provider names to concrete provider instances. |
| `createBudgetPool` | function | Create a conserved reservation pool from a root `Budget`. `now()` is injected so the |
| `createChatSessionStore` | function | In-memory, process-local conversation store with detached reads and writes. |
| `createEventBus` | function | Create the child→parent coordination bus: one typed pipe for settled outputs, questions, and analyst findings, with a priority-ordered pull queue and a pass-through subscribe lane. |
| `createExecutor` | function | The single built-in executor factory. Picks a leaf backend by data (`config.backend`), |
| `createExecutorRegistry` | function | The open resolver/registry. Pre-registers the three built-ins under their |
| `createFileRunContext` | function | Build a DURABLE run context: the spawn journal and the result blobs are file-backed (fsynced |
| `createInbox` | function | Create the worker-side inbox for the down-leg: the driver's `steer_agent` / `answer_question` messages queue here and the worker's loop drains them at step boundaries and before settle. |
| `createInMemoryRunContext` | function | Build a fresh in-memory run context. Every call returns NEW stores (no shared global |
| `createMcpEnvironment` | function | Wrap any MCP server as an `Environment`: `tools/list` becomes `AgenticTool[]` with provider-safe schemas; the domain supplies only the artifact lifecycle hooks. |
| `createOpenInferenceFileExporter` | function | Create an exporter that APPENDS spans to a local OpenInference-JSONL file, one complete span per |
| `createOtelExporter` | function | Create an OTEL exporter. Returns undefined when no endpoint is configured. |
| `createProgressTracker` | function | Build the settled-work ledger a `StopRule` decides from: record each settlement (idempotent by |
| `createPromptRegistry` | function | Create a registry, optionally seeded. Entries are copied; the registry never aliases caller state. |
| `createPushTraceSource` | function | A push source for OWNED tool loops (router-tools / cli-bridge tool dispatch): the loop calls |
| `createRootHandle` | function | Mint a `RootHandle` plus its supervisor-private control. The handle is the substrate a |
| `createSandboxLineage` | function | Build a lineage bound to one client + its probed capabilities. The |
| `createSandboxToolPartState` | function | Fresh per-turn {@link SandboxToolPartState} for {@link mapSandboxToolEvent} — an |
| `createScope` | function | Create the reactive `Scope` a driver's `Agent.act` runs inside: spawn children on an atomically reserved conserved budget, settle via the `next()` cursor, journal for replay. |
| `createScopeAnalyst` | function | Build a `ScopeAnalyst` that spawns the analyst agent through `Scope.spawn` (so its compute is |
| `createShapeRegistry` | function | Build a fresh open `ShapeRegistry`. A factory is stored type-erased and re-cast on resolve — the |
| `createSteerableSandboxSession` | function | One steerable sandbox worker. The returned session is inert until `stream()` is drained. |
| `createSupervisor` | function | Create a supervisor that owns one recursive agent execution tree. |
| `createSupervisorSpanRecorder` | function | Build the span recorder for one supervised run, or `undefined` when no exporter resolves — the |
| `createTangleSandboxExactProcessProvider` | function | Adapt Tangle Sandbox's managed control runtime to Runtime's exact-process provider. |
| `createVerifierEnvironment` | function | Any checkable task as an `Environment`, no tool surface required: the artifact is the worker's answer and the domain is one deployable `check` over it. |
| `createWaitProbes` | function | Registry over a plain name→predicate record. |
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
| `effectiveConcurrency` | function | The ONE honest effective limit on simultaneous workers: the minimum of the caps that actually |
| `envKeyProvider` | function | The env-backed provider: reads the (dotenvx-loaded) process env. Empty / |
| `equalKOnCost` | function | Assert the arms are comparable at EQUAL conserved COST (tokens + usd), NOT raw iteration |
| `extractLlmCallEvent` | function | Extract a `RuntimeStreamEvent`-shaped `llm_call` from a sandbox event when |
| `failuresAnalyst` | function | The default self-improvement LENS — authored content, not a code path. On each settled worker it hands |
| `fanout` | function | `fanout(items, opts)` — spawn one child per item in a single round (bounded by the conserved |
| `filterAuthoredAsserts` | function | The proven authored-assert filter (lifted from the rigs' generateTests): keep only |
| `finalizeBestDelivered` | function | Keep-best finalize under the completion-oracle: return the highest-scoring DELIVERED child's |
| `flatWidenGate` | function | The flat default `ScopeWidenGate` — never widens, keeping the R2 selector≠judge collision |
| `formatPromptHandle` | function | The string form of a handle: `<surface>/v<n>`. |
| `freeSlots` | function | Free worker slots under a simultaneity cap: `cap - live`, floored at 0, or `null` when there is |
| `gateOnDeliverable` | function | Wrap an `Executor` so its settlement `valid` reflects the deliverable check, not the |
| `gitWorkspace` | function | A `Workspace` over a git checkout: materialize an isolated worktree at `ref`, commit produced changes (conflict-aware), and read `head` — hooks disabled, identity pinned. |
| `harvestCorpus` | function | Batch the firewalled `observe()` analyst over completed runs and accrete the trace-derived facts into the durable corpus — the production-traces→corpus write side of the flywheel. |
| `inlineSandboxClient` | function | Adapt an `ExecutorFactory` into a `SandboxClient` for `runAgentRounds`. The factory is |
| `inProcessSandboxClient` | function | Adapt a single `onPrompt(prompt, ctx)` callback into a `SandboxClient` for |
| `isWaitOutcome` | function | Narrow a settlement's `out` to a wait outcome — a wait settles on the SAME cursor as workers, |
| `jjWorkspace` | function | A jj-backed `Workspace` (Jujutsu, colocated with git for the durable remote). |
| `kernelPromptRegistry` | function | The kernel's seeded registry: every surface the runtime's own builders derive from. A caller |
| `leaderboard` | function | Aggregate a fleet of records into the ranked, multi-axis report. Pure — no IO, deterministic. |
| `legacySupervisorRunDir` | function | Where a pre-rename writer put the same run (`<root>/.loops/supervisor/<id>`). Readers that must |
| `legacySupervisorRunsRoot` | function | The pre-rename runs root (`<root>/.loops/supervisor`). Only readers that ENUMERATE historical |
| `loadSpawnForest` | function | Load every journal tree owned by one recursive supervision run and flatten its nodes/events. |
| `localSandboxClient` | function | A same-host `SandboxClient` adapter with no process isolation. Local MCP is |
| `localShell` | function | Host-process `Shell`: run a command via `execFile`, resolving `{ stdout, stderr, code }` (never throws on non-zero exit). |
| `loopCampaignDispatch` | function | Adapter for plain `runCampaign` scenarios. This is the Runtime-side pair for |
| `loopDispatch` | function | Adapter for `runProfileMatrix` (profile is an axis). Returns a |
| `loopUntil` | function | `loopUntil(seed, spec)` — one `step` child per round; `fold` accumulates each settlement into |
| `makeFinding` | function | Convenience factory: produce a fully-formed AnalystFinding with the |
| `mapExecutorResult` | function | Transform a Runtime executor's terminal artifact without losing its private |
| `mapSandboxEvent` | function | Project one `SandboxEvent` onto the `RuntimeStreamEvent` chat-UX vocabulary, |
| `mapSandboxToolEvent` | function | Project one `SandboxEvent` onto the `tool_call` / `tool_result` variants of |
| `materializeLocalMcp` | function | Spawn every explicitly trusted stdio server in `profile.mcp` as a same-host |
| `materializeTreeView` | function | Materialize a recorded `TreeView` from a journaled event list for inspection. Folds |
| `modelAuthoredChecks` | function | Default authored-check source: one metered LLM call per task, before sampling, |
| `noProgressFor` | function | "Nothing new has happened." Fires when the run has produced no new settled work for `ms`, or no |
| `normalizeAnalyzeOnSettle` | function | Normalize the two spellings of an analyst-on-settle entry to the route form. |
| `observe` | function | The third-person trace analyst: read a worker's trace and produce steer findings for the next attempt plus durable `learned` facts for the cross-run corpus. |
| `officialChecksFromMeta` | function | Official checks the surface stashed on the task (e.g. MBPP's shown assert). Reads |
| `openSandboxRun` | function | Open a sandbox run. Harness-agnostic: the harness lives in |
| `pairwiseSignificance` | function | Compare EVERY profile pair on the scenarios they both ran — paired-bootstrap effect + CI, a real |
| `panel` | function | `panel(spec)` — spawn the M judge children over the SAME artifact, drain their settlements, |
| `parseWorkerToolTraceArtifact` | function | Validate a stored trace artifact before an analyst or replay trusts it. |
| `patchDelivered` | function | Build the `DeliverableSpec<WorktreePatchArtifact>`: `check(artifact)` runs the shared mechanical |
| `pendingWaits` | function | The waits a journaled tree shows as ARMED but never woken — what a resumed run re-arms with the |
| `pickBestDelivered` | function | The single argmax both the default finalizer and `finalizeBestDelivered` share: highest |
| `pickChampion` | function | The champion pick over a means table. 'score' takes the best mean score (ties → |
| `pipeline` | function | `pipeline(stages)` — run the stages in order, feeding each stage's `done` deliverable into the |
| `plateau` | function | "The objective has stopped climbing." Fires when the best-so-far curve has risen by no more than |
| `plateauLength` | function | How many trailing entries of a best-so-far curve are within `minDelta` of the curve's value |
| `pollFor` | function | Build a bounded `poll` spec from a duration. |
| `printBenchmarkReport` | function | Pretty-print a report — the "free optimization" verdict, with the cost vector. |
| `probeSandboxCapabilities` | function | Probe (and memoize per client) what the loop may rely on. A client without a |
| `profileChatClient` | function | Profile-exact adapter for packages that consume agent-eval's ChatClient contract. |
| `profileOptimizerModelCall` | function | Profile-exact adapter for agent-eval's external optimizer callback. |
| `profileRichnessFinding` | function | Turn a {@link ProfileRichness} verdict into a bus-routable `AnalystFinding` (area `profile-quality`). |
| `promotionGate` | function | Statistical promotion decision over a holdout benchmark using the outcome-appropriate interval selected by `heldoutSignificance`. |
| `promptHandle` | function | Parse `'<surface>/v<n>'` into a {@link PromptHandle}. The shorthand for authoring a graph edge: |
| `providerAsExecutor` | function | Adapt an environment provider into an `ExecutorFactory` for `createExecutor`. |
| `providerAsSandboxClient` | function | Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths. |
| `queueOf` | function | Convenience: a `DispatchUnit` factory over a fixed array of tasks, for the common case where |
| `readWorkerProgress` | function | Fold the scope-derived facts and the executor's optional enrichment into one read. Pure: the |
| `readWorkerSteerRequests` | function | Read every valid steer request in a worker's inbox. Corrupt or partial lines are skipped. |
| `readWorkerTraceContext` | function | Read the inherited trace context off an `ExecutorContext`, or `undefined` when the run records no |
| `registerShape` | function | Register a composed shape on the default `builtinShapes` registry — the one-call extension |
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
| `resolveMcpServerLaunch` | function | Resolve a profile MCP server's `args`/`env` config values (interface ≥0.40 |
| `resolveSandboxClient` | function | Resolve a `SandboxClient` for the chosen backend. The generic, dep-light core |
| `resolveSecretEnv` | function | Resolve a declared secret-env map into the real env entries for a server |
| `resolveSupervisorProfile` | function | Reduce one canonical executable profile to the scalars the two brain arms consume. |
| `rollingDispatch` | function | Run the refilling dispatch loop over `scope` until the queue is dry (or a stop fires) and every |
| `runAgentic` | function | Run a Strategy through the keystone Supervisor — `Agent.act` over a conserved-budget Scope. |
| `runAgentRounds` | function | The round-synchronous MULTI-AGENT kernel: each round `driver.plan()` fans N tasks |
| `runBenchmark` | function | Run the requested strategies over the tasks, scored by the Environment's own check. |
| `runFinalizer` | function | Run a finalizer over a settled-worker ledger under the delivered-only invariant: filter the |
| `runGraph` | function | Execute an {@link AgentGraph}. The root node becomes the supervisor (`supervise()` — the |
| `runInWorkspace` | function | Run a worker `body` inside a FRESH clone of a shared `Workspace`, then commit its work back |
| `runPersonified` | function | Compose the persona + chosen shape onto a fresh keystone `Supervisor`. Resolves the shape |
| `runStrategyEvolution` | function | Multi-generation strategy search: author candidates from tournament losses, play them against the incumbent at equal budget, promote via `promotionGate` on an untouched holdout slice. |
| `runTree` | function | The tree that describes the WHOLE run: this process's live nodes plus, on a resumed run, the |
| `safeWorkerFile` | function | A worker label reduced to a safe filename stem. Empty labels get a stable fallback. |
| `sampleFromSettled` | function | Build a `ProgressSample` from a scope settlement. The objective is the verdict score and |
| `sandboxCheckRunner` | function | Default CheckRunner backend: pipes the check program into `python3` over the sandbox |
| `sandboxClientAsProvider` | function | Adapt a `SandboxClient` into the shared `AgentEnvironmentProvider` contract. |
| `sandboxSessionTraceSource` | function | The SANDBOX / fleet trace source: read a box session's message parts and decode the harness's tool |
| `sanitizeMcpToolSchema` | function | Coerce an MCP inputSchema to an OpenAI-tool-valid top-level object schema. |
| `secretEnvOfMcpServer` | function | Read (and validate) a server entry's declared secret-env map, if any. |
| `selectBestIndex` | function | Argmax by `compareCheckOutcomes`, FIRST index wins ties (deterministic; with zero |
| `selectChampion` | function | Search-side champion selection over a tournament report. |
| `selectValidWinner` | function | The single content-free valid-only winner selector. Among the gated-VALID children only |
| `sentinelCompletion` | function | Completion for a sandbox-agent node: done iff the latest output carries the node's stop |
| `serveCoordinationMcp` | function | Stand up the coordination MCP over a live scope. The HOST address is `127.0.0.1` (the bridge runs |
| `settledToIteration` | function | The step-8 merge-boundary adapter (M4): rehydrate a `Settled.done` into the kernel's |
| `settledWorkerOut` | function | What a settled worker exposes as its output artifact (the blob the brain's |
| `spendFromUsageEvents` | function | Fold a normalized `UsageEvent` array into a `Spend`. Tokens and usd are separate |
| `stopSentinel` | function | A unique, attributable stop sentinel for a node (ralph-loop style). Deterministic from the |
| `streamAgentTurn` | function | Run ONE agent turn on any backend kind and stream its events. Yields the |
| `structuralRollout` | function | Build the structuralRollout `Strategy`: k shots → score each by the frozen visible |
| `sumSandboxUsage` | function | Sum the token usage + USD cost of a sandbox turn's events — the one honest way to meter an |
| `supervise` | function | One-call supervisor: build + run a supervisor from its profile with sensible defaults; the raw `supervisorAgent` + `createSupervisor().run` seams stay available for power use. |
| `superviseSurface` | function | Drive a team of agents (spawned + steered by `profile`) to solve a graded `AgenticSurface` task, and |
| `supervisorAgent` | function | Build a supervisor `Agent` from its profile: the brain resolves from `profile.harness` (backend-as-data), the same resolution rule as every worker. |
| `supervisorInstructions` | function | The supervisor SKILL — the how-to the supervisor reads (its system prompt). THE optimizable |
| `supervisorRunDir` | function | The run directory every artifact of one supervisor run lives under. |
| `supervisorRunsRoot` | function | The root every supervisor run of one workspace lives under. |
| `supervisorWorkersDir` | function | The directory holding every per-worker file of one run (inboxes and control-event logs). |
| `timerAt` | function | Build a `timer` spec from a DURATION. The instant is resolved once, at arm time — a resumed |
| `trajectoryReport` | function | Reconstruct the whole spawn tree for `root` with per-node + rolled-up `Spend`. Reads the |
| `validateWaitSpec` | function | Structural validation, independent of the run. Returns null when the spec is usable. |
| `verify` | function | `verify(spec)` — an IMPLEMENT child produces a candidate, then a SEPARATE VERIFIER child grades |
| `visibleCheckScore` | function | Display scalar for receipts/reports (the rigs' `visibleScore` shape): crash = -1, |
| `waitUntil` | function | The absolute instant a spec is bounded by, or `undefined` for an unbounded poll. |
| `watchTrace` | function | Subscribe to a `TraceSource` and run the streaming detectors over its live spans. Returns an |
| `widen` | function | `widen(spec)` — the streaming spawn-on-completion driver. Spawns the seed lineages, then REACTS |
| `withUntrackedArtifacts` | function | Wrap a `Workspace` so every `materialize` (the per-worker `git clone` inside |
| `workerControlLogFile` | function | The best-effort control-event log for one worker (`workers/<label>.ndjson`) — delivery |
| `workerFromBackend` | function | Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the |
| `workerInboxFile` | function | The durable inbox file for one worker of one run. |
| `workerInboxFileFromEventDir` | function | Same, addressed from an already-known run directory (the reader's usual entry point). |
| `workerTraceAnalysisStore` | function | Rehydrate exact persisted spans through agent-eval's one bounded trace-analysis adapter. |
| `workerTraceEnv` | function | The trace env to merge into a worker's environment — `TRACEPARENT` plus the legacy |
| `worktreeFanout` | function | Build the worktree fanout combinator. Run it with `runPersonified({ persona, shape, task, budget })` |
| `writeWorkerSteer` | function | Durably append one steer request to a worker's inbox and log the delivery attempt. |
| `adaptiveRefine` | const | A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot |
| `analyzesFindingsReportPrompt` | const | Default ANALYZES-edge directive: what the RECEIVING node should do with an analyst's findings. |
| `assertTraceDerivedFindings` | const | Reject analyst findings derived from evaluation scores instead of execution traces. |
| `bestDelivered` | const | Keep-best under the completion oracle — the DEFAULT finalizer and the exact behavior every |
| `builtinShapes` | const | The default registry `runPersonified` resolves a shape name against. Empty by construction — |
| `cliWorktreeExecutor` | const | The leaf `createWorktreeCliExecutor` as a backend-as-data factory: a supervisor-authored |
| `collectDelivered` | const | Every verified distinct output, highest score first — the shape for competing hypotheses, a |
| `DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY` | const | Manager-authored profiles are untrusted until product policy says otherwise. Remote MCP and |
| `DEFAULT_AWAIT_EVENT_TIMEOUT_MS` | const | Default ceiling for a single `await_event` block (ms). Chosen well under any reasonable remote |
| `DEFAULT_SANDBOX_STEERING_MAX_TURNS` | const | Ceiling on continuation turns. Turn 0 is the task; every later turn is a folded steer, so |
| `DEFAULT_STALL_AFTER_MS` | const | How long a worker may produce no metered activity before a `progress()` read calls it stalled. |
| `defaultAnalystInstruction` | const | The default observer instruction — exported so an optimizer can seed its population. |
| `defaultAuditorInstruction` | const | Default system instruction for intent-auditor agents: diagnose diverged/drifting trajectories. |
| `defaultDelegateBudget` | const | The conserved pool a `delegate()` call applies when the caller does not pass its own `budget`. |
| `defaultEdgeTraversalCap` | const | Default per-edge traversal cap — the cyclic-graph backstop when an edge names none. |
| `defaultProfileRichnessThresholds` | const | Default thresholds for `ProfileRichnessThresholds` — 600 chars / 6 lines minimum system prompt. |
| `defaultStructuralRolloutPolicy` | const | The measured default recipe: 5 samples, 2 guarded repair rounds, 6 authored checks. |
| `delegatesWorkerBriefPrompt` | const | Default DELEGATES-edge directive: the standing instruction a worker receives with every |
| `dumbContinuationFailPrompt` | const | Default DUMB steering continuations — the pass/fail-only control re-expressed as data: two |
| `dumbContinuationPassPrompt` | const | The pass branch of the dumb steering control — see {@link dumbContinuationFailPrompt}. |
| `EVIDENCE_MAX_CHARS` | const | Hard cap on one worker's evidence block so the brain's context cannot blow up. |
| `mcpSecretEnvMetadataKey` | const | The `AgentProfileMcpServer.metadata` key the declarative secret-env map |
| `naiveContinuationPrompt` | const | Default NAIVE steering continuation — the no-signal control re-expressed as data: the same |
| `NOTE_MAX_CHARS` | const | Cap on the worker's closing note inside the evidence block. |
| `refine` | const | Built-in `Strategy`: attempt → `observe()` reads the trace → steer the next attempt → repeat (deepen one lineage). |
| `sample` | const | Built-in `Strategy`: K independent attempts, keep the best-verifying (best-of-N / resample). |
| `sampleThenRefine` | const | The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open), |
| `strategyAuthorContract` | const | The compressed consumable a skill carries: everything an author needs to emit a loop. |
| `strategyAuthorSystemPrompt` | const | Standing behavior callers put in the strategy-author AgentProfile. |
| `supervisorPolicyPrompt` | const | THE supervisor policy — one stance, both front doors. The work-vs-delegate rule is conditional |
| `VERIFY_TAIL_CHARS` | const | Tail of the verify output — the failing assertion lives at the END of a test log. |
| `WORKER_TOOL_TRACE_SCHEMA_VERSION` | const | Schema version for content-addressed worker tool-trace artifacts. |
| `workerTraceSeamKey` | const | Seam key the `Scope` seeds a {@link TraceContext} under on each child's `ExecutorContext.seams`. |
| `FileCoordinationLog` | class | FS-backed `CoordinationLog`: append-only JSONL, fsynced per record. |
| `FileCorpus` | class | JSONL on disk — one validated `CorpusRecord` per line, append-only. `query` replays the whole |
| `FileResultBlobStore` | class | FS `ResultBlobStore`. One JSON file per artifact under `dir`, named by a |
| `FileSpawnJournal` | class | JSONL on disk. One line per record: the first record is `begin`, subsequent records |
| `GraphEdgeCapError` | class | A delegates edge exhausted its traversal cap and the run produced no winner: the cap, not the |
| `InMemoryCorpus` | class | In-memory `Corpus`. Keyed by record `id`; `append` validates the record, is idempotent on an |
| `InMemoryResultBlobStore` | class | In-memory `ResultBlobStore`. Content-addressed: `put` verifies the supplied |
| `InMemorySpawnJournal` | class | In-memory `SpawnJournal`. Appends are observed-committed only; the impl enforces |
| `McpSpawnFault` | class | A missing start binary / spawn fault: a SETUP bug, never a failed candidate. |
| `SandboxInstance` | class | A sandbox instance with methods for interaction. |
| `SandboxRunAbortError` | class | Thrown when a turn is aborted/timed-out mid-settle. Carries the events drained |
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
| `AnalystFinding` | interface | Unified envelope every analyst emits. Schema-versioned so renderers |
| `AnalystFindingEvent` | interface | A trace-analyst result re-entered as a message on the bus (the `finding` event kind). |
| `AnalyzeOnSettleRoute` | interface | One analyst-on-settle ROUTE: which lens runs (`kind`), over WHICH settled workers (`over`), |
| `AuthorizedDownMessage` | interface | Product-authorized continuation bytes. Returning a narrowed instruction replaces the proposed |
| `AuthorizedSpawn` | interface | The product-authorized result for one complete spawn request. Attribution is never accepted |
| `AuthorizedSpawnContext` | interface | Exact trusted context after a manager-authored spawn has passed product authorization. |
| `BenchmarkCell` | interface | One strategy's outcome on one task — the per-task cell an optimizer consumes. |
| `BenchmarkReport` | interface | Benchmark output: per-strategy means plus the full per-task × per-strategy losses table an optimizer mines. |
| `BridgeSeam` | interface | cli-bridge seam. A local OpenAI-compatible bridge that fronts harness CLIs |
| `Budget` | interface | A budget envelope on a spawn or the root. All ceilings; the pool reserves against them. |
| `BudgetPoolRestore` | interface | State recovered from a prior process before new work is admitted. `committed` is measured spend |
| `BusEvent` | interface | Every bus event is a discriminated union member keyed by `type`. |
| `BusRecord` | interface | A published event stamped for ordering and observability. `seq` is the monotonic publish index; |
| `ChatSessionStore` | interface | Conversation history keyed by the settled Runtime worker id. |
| `ChatTransportExecutorOptions` | interface | Transport and session data for one exact profile-driven conversation. |
| `ChatTransportTool` | interface | One profile-authorized function tool and its host implementation. |
| `ChatWorkerSeamOptions` | interface | Transport/session configuration shared by every spawned exact profile. |
| `CheckExecChannel` | interface | Minimal exec channel the default runner needs. `SandboxInstance` (and therefore |
| `CheckOutcome` | interface | How one candidate fared against the frozen visible checks, split by check kind. |
| `CheckpointCapableBox` | interface | Loop-side widening of the box's optional checkpoint method. The |
| `CheckRunner` | interface | Executes the frozen checks against one candidate. Implementations MUST fail loud |
| `CheckSource` | interface | Produces the task's visible checks. MUST derive them from agent-visible information |
| `CheckSourceCtx` | interface | What a CheckSource composes with. `consult` is the strategy family's raw analyst |
| `CliSeam` | interface | UNMETERED CLI subprocess seam. `bin` + `args` describe the process to spawn. |
| `CliWorktreeSeam` | interface | cli-worktree seam. A supervisor-authored `AgentProfile` driving a local coding-harness CLI |
| `CollectedAgentTurn` | interface | A drained turn: the terminal summary plus every event the stream yielded. |
| `CompletionAnalyst` | interface | Reads a node's trace → a completion verdict. Same input shape as the `analyze` hook, so |
| `CompletionEvidence` | interface | Trace-derived evidence for a completion claim — an artifact (output) or a verifier metric, |
| `CompletionPolicy` | interface | When a verdict authorizes the driver to END. Deterministic → trust (ground truth); |
| `CompletionVerdict` | interface | The "is it done?" verdict an analyst returns to the parent. |
| `ConcurrencyCaps` | interface | The caps a host can set on simultaneous work. See the ledger in this module's header for what |
| `ContinuationInstruction` | interface | Durable authorization receipt written before a continuation reaches a worker. |
| `CoordinationBinding` | interface | Where the coordination MCP binds. Omit = an ephemeral port on `127.0.0.1` (the local-harness |
| `CoordinationLog` | interface | The durable coordination side-log seam. `append` records one bus event (kinds it does not |
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
| `DeliveredOutput` | interface | One DELIVERED child, materialized: settled `done`, oracle-passed, output rehydrated. `out` is |
| `DispatchUnit` | interface | One unit of queued work: the agent to run, its task, and the spawn options (budget + label). |
| `DownMessageAuthorizationInput` | interface | Detached continuation bytes and exact worker identity presented to product authorization before |
| `DownMessageDeliveryAttempt` | interface | A durable marker written after authorization and immediately before Runtime calls `Scope.send`. |
| `DownMessageEvent` | interface | A parent→child delivery result (the down-leg): recorded for observability, never pulled back by |
| `DriveHarness` | interface | How to run an external harness as the DRIVER, with the coordination verbs mounted — the substrate |
| `EdgeTraversal` | interface | One recorded edge traversal — the in-memory row; the journal twin is the `edge` SpawnEvent. |
| `EqualKArm` | interface | One arm of an equal-k comparison — a labeled trajectory (a `TrajectoryReport` is one arm's whole |
| `EqualKOnCostOptions` | interface | `equalKOnCost(arms, { tolerance? })` — assert arms are comparable at EQUAL conserved COST |
| `EqualKVerdict` | interface | The equal-k-on-cost verdict: whether every arm spent within `tolerance` of the others on the |
| `ExecCtx` | interface | Execution context for `runAgentRounds`: the sandbox client the kernel creates boxes through, plus optional runtime hooks. |
| `Executor` | interface | The leaf runtime — ONE open interface, not a closed union. `execute` returns a |
| `ExecutorAccounting` | interface | Split used by a recursive executor when journaled child work differs from the full amount |
| `ExecutorContext` | interface | Construction context handed to a `ExecutorFactory` — the seams a built-in needs |
| `ExecutorExecutionBinding` | interface | Volatile execution routing that is true for one attempt but is not profile identity. The full |
| `ExecutorMaterialization` | interface | Data-only declaration from trusted executor code about the exact sealed plan `execute` uses. |
| `ExecutorNodeContext` | interface | Kernel-owned context for the concrete supervised node a factory is constructing. |
| `ExecutorProgress` | interface | What an executor OPTIONALLY adds to the scope-derived progress (`Executor.progress()`). Every |
| `ExecutorRegistry` | interface | The OPEN resolver maps an already-admitted `AgentSpec` to an `ExecutorFactory`. Scope validates |
| `ExecutorResult` | interface | Terminal artifact of a one-shot `Executor.execute`. |
| `FanoutOptions` | interface | `fanout(items, { synthesize? })` — N children spawned in one round (one per item, bounded by |
| `FanoutSynthesis` | interface | How a fanout's synthesis child is built + read. `synthesisTask` projects the drained child |
| `FinalizeContext` | interface | What a finalizer gets to decide with. `delivered` is the ONLY output material; `allSettled` |
| `FinalizerSettled` | interface | One settled worker as the finalizer sees it — the ledger row (structural fields only). |
| `ForkCapableBox` | interface | Loop-side widening of the box's optional fork method. |
| `GraphNode` | interface | A graph node: an id and a canonical `AgentProfile`. The profile is the ONLY way a node is |
| `Handle` | interface | A live child handle. `abort()` is defined over the ACQUIRE lifecycle: it chains into |
| `InboxMessage` | interface | The worker-side receive end of the down-leg: a per-worker inbox an executor exposes as |
| `InMemoryRunContext` | interface | The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`. |
| `InMemoryRunContextOptions` | interface | Options for a supervised run context. |
| `InProcessPromptCtx` | interface | Context handed to each `onPrompt` call. |
| `Interval` | interface | A 95%-by-default confidence interval. |
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
| `LocalMcpMaterialization` | interface | The live same-host materialization of a profile's `mcp` surface. |
| `LoopCampaignDispatchOptions` | interface | Options for adapting plain agent-eval campaign scenarios into Runtime cells. |
| `LoopIterationDispatchPayload` | interface | Where the iteration's worker was placed. `sibling` = a fresh sandbox the |
| `LoopLineageOptions` | interface | Opt-in box-lineage controls for `runAgentRounds`. Default OFF — with both flags |
| `LoopPlanPayload` | interface | Emitted once per `plan()` round, immediately after the driver plans. Carries |
| `LoopTeardownFailedPayload` | interface | Emitted when a box's `delete()` throws or times out during teardown — the |
| `LoopTokenUsage` | interface | LLM token usage. Structurally maps into agent-eval's paid-call receipt so a |
| `LoopUntilSpec` | interface | `loopUntil({ until, step })` — iterative deepening inside the conserved pool: spawn one `step` |
| `LoopUntilState` | interface | The accumulated state `loopUntil` threads across rounds — the running candidate + the round |
| `MaterializedExecutionIdentity` | interface | External execution identity that operators can use to join this node to its backend. |
| `McpEndpoint` | interface | Where a handle's MCP server lives; headers carry per-artifact scoping. |
| `MountManifestEntry` | interface | One mounted resource recorded during box preparation — a pure provenance |
| `NodeExecutionIdentity` | interface | Durable identity of one realized node. Missing digests mean the input was not canonical JSON. |
| `NoWinnerError` | interface | A driver's `act()` rejection, normalized to a serializable triple so it survives the typed |
| `OpenSandboxRunBeforeStartContext` | interface | Context available after the box/session exists and before the first prompt is |
| `OutputAdapter` | interface | Stream of `SandboxEvent`s → typed `Output`. |
| `PairwiseVerdict` | interface | One profile pair compared on the scenarios they BOTH ran — the "who actually beat whom" verdict. |
| `PanelJudge` | interface | One judge in a panel — a labeled persona-derived judge child. Content (the rubric) lives in |
| `PanelSpec` | interface | `panel(judges)` — M judges over ONE artifact, merged WRITE-ONLY (selector≠judge taken to its |
| `PanelVerdict` | interface | One judge child's settled verdict, surfaced to the write-only `merge`. `down` judges carry no |
| `PendingWait` | interface | A wait recorded in the journal that never woke — what a resumed run re-arms. |
| `Persona` | interface | The "act like X" record. A thin composition over the keystone's `AgentSpec`: it pairs the |
| `PersonaContext` | interface | The persona context blob — who the loop is acting as. Open by intent: a persona names its |
| `PersonaExecutors` | interface | How a persona supplies executor resolution. Either a pre-built registry (factories already |
| `PipelineStage` | interface | `pipeline(stages)` — sequential composition: each stage's `Outcome.deliverable` feeds the next |
| `PriorCoordination` | interface | Coordination evidence loaded from prior processes of one durable supervised run. |
| `ProfileRichness` | interface | Per-field verdict on one authored profile — the raw material the bench renders + scores. |
| `ProfileRichnessThresholds` | interface | Thresholds below which a system prompt is treated as a thin stub. Tunable per call. |
| `ProgressSample` | interface | One settled unit of work, reduced to what a stop rule reads. `objective` is the run's own |
| `ProgressTracker` | interface | Accumulates settlements and materializes a `ProgressView`. Idempotent by settlement id, so a |
| `ProgressView` | interface | The read-model a `StopRule` decides from — the run's progress, not its budget. |
| `PromptHandle` | interface | A versioned reference into a prompt registry: `surface` names the role/edge the text serves, |
| `PromptRegistry` | interface | Versioned prompt store. `resolve` fails loud on an unknown handle: a directive that silently |
| `ProviderAsSandboxClientOptions` | interface | Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port. |
| `ProviderExecutorOptions` | interface | Options for running a provider as a supervise-mode executor. |
| `ProviderSeam` | interface | Generic environment provider executor config. External packages implement |
| `RegisteredPrompt` | interface | One registry entry: the handle plus the text it pins. |
| `RegistryAnalyzeProjection` | interface | Project a `ScopeAnalyzeInput` into the `AnalystRegistry.run` arguments. The registry runs over a |
| `RenderCorpusToInstructionsOptions` | interface | Project accreted corpus facts into an `AgentProfile`'s instruction seams — the learning-flywheel |
| `ReservationTicket` | interface | Opaque, single-use reservation handle returned by `reserve` and consumed by |
| `ResolvedMcpServerLaunch` | interface | The spawn-ready strings for one stdio MCP server: profile config values |
| `ResolvedSupervisorProfile` | interface | The exact profile fields consumed by supervisor materialization. |
| `ResultBlobStore` | interface | Content-addressed result blobs (the `outRef` → artifact map) backing the replay |
| `ResumedKeyState` | interface | What the journal proves about one keyed assignment at resume time. |
| `ResumedWork` | interface | The committed work a resumed run inherits from its journal. `settled` is the replayed |
| `RootHandle` | interface | Live root handle — a chat/pi-viz client uses it to inspect and control one root run. |
| `RouterSeam` | interface | Router/inline transport seam. The profile owns model, prompt, and generation behavior. |
| `RouterToolsSeam` | interface | Router seam WITH tool use — the tool-using router backend. Same direct |
| `RouterTransportConfig` | interface | Connection details for Runtime's Router-backed executors. |
| `RunPersonifiedOptions` | interface | The end-to-end entrypoint. Builds the persona's root `Agent` from the chosen shape, then |
| `RunProvenance` | interface | Domain-free run provenance: a manifest of what was mounted into the run's |
| `SandboxCapabilities` | interface | What the loop kernel is allowed to know about a sandbox backend: a single |
| `SandboxClient` | interface | Minimal sandbox client surface the kernel calls. Satisfied structurally by |
| `SandboxClientProviderOptions` | interface | Options for wrapping the current Tangle sandbox client as an environment provider. |
| `SandboxEvent` | interface | SSE event from sandbox streaming. |
| `SandboxLineage` | interface | Owns box + session handles for one loop run and offers the three |
| `SandboxLineageHandle` | interface | A live box plus the session that threads its iterations together. Handed back |
| `SandboxSeam` | interface | Sandbox executor seam. The `sandboxClient` the composed `runAgentRounds` creates |
| `SandboxSteeringOptions` | interface | Opt-in configuration for the steerable sandbox worker (`SandboxSeam.steering`). Absent, the |
| `SandboxToolPartState` | interface | Cross-event state for {@link mapSandboxToolEvent}. Sandbox backends emit a |
| `Scope` | interface | The budget-conserving reactive scope an `Agent.act` runs inside. `spawn` reserves |
| `ScopeAnalyst` | interface | The reactive analyst seam — the PORT of the round-synchronous driver's `analyze` hook |
| `ScopeAnalyzeInput` | interface | Input to a `ScopeAnalyst.analyze` — the root task framing + the children settled so far. |
| `ScopeArgs` | interface | Construction args for `createScope`. The supervisor threads the shared pool, journal, |
| `ScopeProgressInput` | interface | The scope-side facts about a child, independent of whether its executor cooperates. |
| `ScopeWidenGate` | interface | The runtime widening gate (the reactive analogue of the keystone's `WidenGate`, lifted to read |
| `SelectionReceipt` | interface | A record of one candidate-selection decision: which iteration the selector |
| `SessionCapableBox` | interface | Loop-side widening of the box's optional session accessor. The real |
| `SessionMessageLike` | interface | A harness session message carrying parts (the shape `box.messages()` returns). Structurally typed |
| `SessionTraceBox` | interface | The minimal box surface this needs: list a session's messages (incl. mid-turn partials). |
| `ShapeBudget` | interface | Budget knobs a shape reads to size its fanout/children WITHOUT owning the conserved pool. |
| `ShapeContext` | interface | The construction context a `LoopShape` factory receives. Carries the persona's resolved |
| `ShapeRegistry` | interface | The open shape registry — the extension point that makes a new loop-shape ONE file + one |
| `SpawnForest` | interface | Complete cold-readable view of one recursive supervision run. |
| `SpawnForestEvent` | interface | One event with the journal tree that establishes its cursor namespace. |
| `SpawnForestInDoubtNode` | interface | A spawned worker with no terminal record in a cold snapshot. Resume treats the same state as |
| `SpawnForestMissingTree` | interface | A driver spawn whose owned journal tree was never begun before the process stopped. |
| `SpawnForestNode` | interface | One flattened node with the journal tree that owns its records. |
| `SpawnForestTree` | interface | One journal tree in a recursively loaded supervision forest. |
| `SpawnJournal` | interface | The spawn-tree event source (mirrors `ConversationJournal`'s begin/append/load shape). |
| `Spend` | interface | Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd |
| `SteerableRootHandle` | interface | A Runtime-minted root handle that can deliver raw steering or answers to a live manager inbox. |
| `SteerableSandboxSession` | interface | What the steerable session exposes to its executor: the usage stream plus the live reads. |
| `SteerContext` | interface | How a combinator's `act` consumes findings to steer — the SINGLE firewalled steer surface a |
| `StrategyArtifacts` | interface | Artifact lifecycle a strategy may manage itself — open/close ONLY. Raw `call`/`score` |
| `StrategyCtx` | interface | What a strategy body composes with: the artifact lifecycle, the budget, and the two steps. |
| `StrategyShotResult` | interface | Measured result of one strategy shot. |
| `StructuralRolloutPolicy` | interface | The rollout's compute recipe — promoted from the proven rigs' env vars (K/REPAIRS/ |
| `StructuralRolloutResult` | interface | The body's deliverable — a `StrategyResult` plus selection provenance. The extra |
| `SuperviseRegistry` | interface | The name→value tables that make the four CODE-valued options expressible as run DATA. |
| `SuperviseRegistryTable` | interface | A name→value table, in this package's resolver-port shape (the same one `WaitProbeRegistry` |
| `SuperviseSurfaceResult` | interface | The deployable outcome of a supervised surface run. |
| `Supervisor` | interface | Owns the conserved pool, the spawn log, the abort cascade, the OTP intensity breaker, |
| `SupervisorNodeContext` | interface | Trusted run/node identity Runtime binds to one manager. Model-authored tool arguments cannot |
| `SupervisorSpanOutcome` | interface | How the supervised run ended, as `finish()` records it on the root span. |
| `SupervisorToolDescriptor` | interface | One product-owned tool. It reuses the canonical MCP descriptor fields while Runtime supplies |
| `SupervisorToolInvocationContext` | interface | Trusted context for one product-tool invocation. The node identity remains the same detached, |
| `SurfaceWorkerConfig` | interface | How a worker runs the surface task (its router substrate + per-attempt bounds). |
| `SurfaceWorkerOut` | interface | What a surface worker settles with — the surface verdict the driver + deliverable read. `resolved` is |
| `ToolLoopCompaction` | interface | Self-compaction — bound the loop's OWN context window the way a fresh-respawn (dumb-Ralph) loop |
| `ToolLoopToolCall` | interface | One provider-neutral tool request emitted by a tool-loop model. |
| `TrajectoryNode` | interface | One node in the reconstructed trajectory tree — a driver OR a leaf, with its OWN spend and the |
| `TrajectoryReport` | interface | The whole reconstructed trajectory — the realized tree + its root-rolled-up total. The |
| `TrajectoryReportOptions` | interface | `trajectoryReport(journal, blobs, root, { withOutputs? })` — reconstruct the whole tree with |
| `TreeView` | interface | The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer. |
| `TurnResult` | interface | One finished turn over the artifact. A failed FS read is surfaced in `readError` |
| `VerifySpec` | interface | `verify({ implement, verifier })` — the 2-node sequential gate: an IMPLEMENT child produces a |
| `VisibleCheck` | interface | One task-visible executable check (e.g. a single-line Python assert). |
| `WaitOpts` | interface | Options for `Scope.wait`. `label` is the wait's identity within its parent scope — it is what |
| `WaitOutcome` | interface | The `out` a settled wait node delivers through `Scope.next()`. `settled` is the outcome the |
| `WaitProbeRegistry` | interface | Resolves a `poll` spec's `probe` name to its predicate. Threaded through `SupervisorOpts` so |
| `WidenGate` | interface | The progressive-widening gate (MCTS-PW). Decides whether a settled child is |
| `WidenLineage` | interface | A lineage the gate may widen toward — the settled child that looked promising + the findings |
| `WidenSpec` | interface | `widen({ gate })` (G5) — the STREAMING spawn-on-completion driver. Unlike the static-fanout |
| `WorkerProgress` | interface | The full live view of one worker, as `observe_agent` returns it mid-flight. |
| `WorkerResumeContext` | interface | The resume lineage a `'resume'` spawn hands the executor seam |
| `WorkerSpawnContext` | interface | Immutable task, allocation, identity attribution, and semantic key supplied while a manager's |
| `WorkerSteerRequest` | interface | One durable down-leg request appended to a worker's inbox file. |
| `WorkerToolTraceArtifact` | interface | Bytes stored under `WorkerTraceEvidence.traceRef`. |
| `WorkerTraceSeamCarrier` | interface | What the two readers below need off an `ExecutorContext` — its seam bag, and nothing else. |
| `WorkerWatchOptions` | interface | Online-detector wiring for spawned workers (`CoordinationToolsOptions.watchWorkers`). |
| `WorktreeCommandResult` | interface | Outcome of one verification command run in the worktree (test or typecheck). |
| `WorktreeHarnessResult` | interface | The canonical result of one worktree-harness run, projected by each port to its own shape. |
| `WorktreeProfileMaterializationReceipt` | interface | Proof of the profile inputs delivered before the worker process started. |
| `AgentEnvironmentProviderRef` | type | Provider object or registry name accepted by runtime provider adapters. |
| `AgentProfileRef` | type | Portable profile reference: inline profile or provider catalog id. |
| `AgentTurnBackend` | type | The execution substrate one turn runs on — a closed discriminated union over |
| `AgentTurnInput` | type | One prompt or an exact OpenAI-compatible conversation carried as the turn input. |
| `AssertTraceDerivedFindings` | type | The firewall assertion contract, re-stated for the reactive seam (PORT of |
| `AuthoredProfile` | type | What the supervisor AUTHORS per sub-task: one complete canonical profile whose name and |
| `AuthorizeDownMessage` | type | Product decision over an exact continuation before it is durably recorded or delivered. |
| `AxisScoresOf` | type | Decompose ONE record into per-axis scores (e.g. judge dimensions). When set, it REPLACES the |
| `BudgetReadout` | type | Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`, |
| `ChatCompletionsTransport` | type | Buffered OpenAI-compatible completion port used only for offline execution. |
| `CombinatorShape` | type | A combinator is just a `LoopShape`: a factory `(ShapeContext) => Agent` whose `Agent.act` |
| `ContinuityMode` | type | How a spawn CONTINUES a node's prior work: `'fresh'` starts a brand-new session (the default, |
| `CoordinationDeliveryEvidence` | type | Durable delivery evidence retained in commit order. An attempt without a later event carrying |
| `CoordinationEvent` | type | Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for |
| `CoordinationOwnerId` | type | Stable identity of the supervisor that owns one coordination stream. High-level supervision |
| `DefinePersona` | type | Builds a frozen `Persona`, failing loud on the executors-supplied invariant (neither a |
| `Deliverable` | type | How a typed deliverable `Out` is materialized from a finished turn. |
| `DeliverableResolutionInput` | type | Exact trusted context for selecting one backend-derived leaf's completion check. |
| `DispatchStopReason` | type | Why the dispatcher stopped admitting work. `drained` = the queue ran dry (the ordinary end); |
| `DownMessageDeliveryOutcome` | type | The exact result of one parent→child delivery attempt. |
| `DriveHarnessOwnerContext` | type | Trusted manager identity available before its external harness starts. A product uses this to |
| `Environment` | type | A checkable task domain — implement these 5 hooks and the suite does the rest. The |
| `EqualKOnCost` | type | `equalKOnCost(arms, opts)` — the cross-arm equal-compute check on conserved cost. |
| `ExecutionBindingReceipt` | type | One attempt's immutable link from a stable materialization plan to its actual transport. |
| `ExecutorConfig` | type | Config for {@link createExecutor}: the backend is DATA — the cost dial a profile, |
| `ExecutorFactory` | type | Builds a fresh `Executor` for one spawn from the resolved, immutable spec. Per-spawn (not shared) |
| `Fanout` | type | `fanout(items, opts)` — build the fanout combinator over a static item list. |
| `FanoutWinnerSelector` | type | A winner-selection strategy: argmax/sort over the gathered child iterations (each output is the |
| `FlatWidenGate` | type | The flat default `ScopeWidenGate` factory contract — never widens, keeping the R2 firewall |
| `GroupOf` | type | The axis (matrix column) a record contributes to — default the scenario group. |
| `InProcessOnPrompt` | type | The user callback: given a prompt and its round, produce the box's event |
| `LoopOptionsForDispatch` | type | runAgentRounds options minus the `ctx` (loopDispatch builds the ctx). |
| `LoopShape` | type | A reusable act-body factory. Given the persona's content + seams (`ShapeContext`), it |
| `LoopUntil` | type | `loopUntil(spec)` — build the iterative-deepening combinator. `seed` is the initial state. |
| `MaterializedModelIdentity` | type | A named model carried into an execution, or an explicit reason the exact model is unknowable. |
| `MountRecorder` | type | Records a mounted resource into the run's provenance manifest. Passed to |
| `NodeId` | type | Deterministic node id — `${parent}:s${seq}` from the cursor order, never wall-clock. |
| `NodeStatus` | type | `'acquiring'` is first-class (M1): a node spends real time + reaps an orphan box |
| `ObserveSupervisorNodeEvent` | type | Context-aware observer used internally to bind product transactions to the actual live node. |
| `OpenSandboxRunPromptOptions` | type | Prompt options forwarded to every sandbox prompt turn in this run. The |
| `Outcome` | type | The terminal contract Drew wants: a loop returns a FINISHED deliverable, or the concrete |
| `Panel` | type | `panel(spec)` — build the M-judge write-only-merge combinator. |
| `Pipeline` | type | `pipeline(stages)` — build the sequential combinator from an ordered stage list. The first |
| `ProfileKeyOf` | type | The profile (matrix row) a record belongs to — default `harness·model` from the record's profile cell, |
| `ProfileMaterializationReceipt` | type | What the kernel can prove about one node's actual execution plan. |
| `RenderCorpusToInstructions` | type | `renderCorpusToInstructions(opts)` — the flywheel read-back projection. Async (queries the |
| `ReservationRejection` | type | Why a reservation was refused. `budget-exhausted` means the pool ran out of a channel it |
| `ResolveDriveHarness` | type | Resolve an external harness for one exact Runtime-owned manager identity. |
| `ResolveSupervisorTools` | type | Product policy for the tools one exact supervisor node may call. Resolved once per node. |
| `Restart` | type | OTP child-spec restart class. |
| `RootMaterialization` | type | Trusted root composition evidence. Generic `Agent.act` roots omit this and remain unknown. |
| `RootSignal` | type | Out-of-band message to a running root. Open by intent — a client extends it. |
| `RunContext` | type | The stores a supervised run needs, in-memory or file-backed. `InMemoryRunContext` is the |
| `RunPersonified` | type | The composed run signature. |
| `Runtime` | type | The runtime tag of a `Executor` impl. Open by intent: custom runtimes use their own string name. |
| `ScoreOf` | type | Pull the headline score in [0,1] from a record. Default: the held-out split, else the search split, |
| `Settled` | type | A settled child, delivered by `scope.next()`. `seq` is the monotonic cursor order |
| `Shell` | type | Command runner seam. Host code can use `localShell`; sandbox code can wrap `box.exec`. |
| `SpawnEvent` | type | Journaled spawn-tree events (B1/B2). `seq` is the cursor order; `at` is an ISO |
| `SpawnPrior` | type | What a KEYED spawn resolved to when the key had a prior attempt. Absent on a fresh key (and on |
| `SpawnRejection` | type | Fail-closed spawn rejections: an exhausted pool, a dollar request against a root that budgets |
| `StopDecision` | type | A stop rule's answer. `reason` is required when stopping — a run that ends must be able to say |
| `StopRule` | type | Evaluated from the progress feed, never from the budget. Pure and synchronous: it is called on |
| `StrategyMessage` | type | One provider-neutral conversation record carried between strategy shots. |
| `StructuralRolloutMessage` | type | Provider-neutral conversation records read by structural candidate extraction. |
| `SupervisedResult` | type | Typed terminal result (M2) — a no-winner is NEVER coerced to a best-effort output. |
| `SupervisorFinalizer` | type | The finalization seam: ledger in, output (or `undefined` = nothing deliverable) out. |
| `SupervisorNodeContextSeed` | type | Context known before `Agent.act`; Runtime adds the concrete node, profile, and task. |
| `SupervisorProfile` | type | A supervisor is an exact canonical AgentProfile; no looser model/prompt shape exists. |
| `SupervisorSpanAttributes` | type | OTLP span attribute values. Exported because `SupervisorSpanOptions.attributes` is public and |
| `ToolLoopChat` | type | One inference turn over the running conversation + the tool specs → the model's text, any |
| `ToolLoopCompactionOptions` | type | Public supervisor-facing compaction config: same knobs as the primitive, but `distill` is optional |
| `ToolLoopMessageRecord` | type | Provider-neutral conversation record accepted by a tool-loop brain. |
| `TrajectoryReportFn` | type | `trajectoryReport(...)` — the tree+cost reconstructor. Async (reads journal + optionally blobs). |
| `TraversalContinuity` | type | How one ledgered hop CONTINUED: a spawn traversal stamps its effective spawn mode |
| `UnknownMaterializationReason` | type | Why exact materialization evidence is unavailable for a node. |
| `UsageEvent` | type | Normalized usage event — the single channel every executor reports through, so the |
| `Verify` | type | `verify(spec)` — build the 2-node implement→verifier-gate combinator. |
| `WaitProbe` | type | A named predicate a `poll` node re-checks. Returns true when the condition it watches has |
| `WaitRejection` | type | Reject reasons for `Scope.wait`, mirroring `Scope.spawn`'s fail-closed admission shape. |
| `WaitSpec` | type | What a wait node is waiting for. Both variants carry ABSOLUTE epoch-ms instants so a wait |
| `Widen` | type | `widen(spec)` — build the streaming progressive-widening combinator. |
| `WidenDecision` | type | A widening decision: extend one lineage by one child, or stop widening. `flatWidenGate` |
| `WinnerStrategy` | type | Built-in valid-only winner strategies for `selectValidWinner` (selector≠judge): best gated-valid |
| `WorkerTraceEvidence` | type | Durable proof of a worker's structured tool trace, or the exact reason it is unavailable. |
| `WorkerTraceResolver` | type | Resolve the trace context a worker spawned BY `spawningNodeId` should inherit. `undefined` means |
| `WorkerTraceUnavailableReason` | type | Why Runtime cannot provide structured tool-call evidence for one settled execution. |
| `WorktreeCheckRunner` | type | The single shell-command-in-worktree runner seam (replaces the per-executor copies). |
| `WorktreePatchArtifact` | type | Terminal artifact of one worktree-CLI run — the canonical worktree-harness result (the captured |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AcquireOptions`, `AgentEnvironment`, `AgentEnvironmentCapabilities`, `AgentEnvironmentEvent`, `AgentEnvironmentProvider`, `AgentEnvironmentQuery`, `AgentEnvironmentSummary`, `AgentGraph`, `AgenticOptions`, `AgenticRunResult`, `AgenticTask`, `AgenticTool`, `AgentSession`, `AgentSessionRef`, `AgentTurnResult`, `AllWorkersStalledOptions`, `AnalystRegistry`, `AnytimeReport`, `AnytimeStrategySummary`, `AnytimeTaskCurve`, `ArtifactHandle`, `AuditIntentInput`, `AuditIntentOptions`, `AuthoredHarness`, `AuthoredStrategy`, `AuthorStrategyOptions`, `BenchmarkConfig`, `BenchmarkLift`, `BenchmarkStrategySummary`, `BenchmarkTaskRow`, `BudgetPool`, `BusStats`, `ChampionPick`, `CheckpointRef`, `CheckpointRequest`, `CheckRunContext`, `CliWorktreeBridgeSeam`, `CoordinationMcpHandle`, `CopyOptions`, `CorpusReadbackOptions`, `CreateAgentEnvironmentInput`, `CreateTangleSandboxExactProcessProviderOptions`, `DefinedLeaderboard`, `DispatchReport`, `Driver`, `DriverAgentOptions`, `EventBus`, `EvolutionArchiveNode`, `EvolutionAuthor`, `EvolutionBandInfo`, `EvolutionCandidate`, `EvolutionGeneration`, `EvolutionReport`, `ExecRequest`, `ExecResult`, `ExecutorResultMapping`, `ForkRequest`, `GitWorkspaceOptions`, `GraphResult`, `HarvestCorpusOptions`, `HarvestFailure`, `HarvestReport`, `Inbox`, `InProcessSandboxClientOptions`, `IntentAudit`, `Iteration`, `Leaderboard`, `LeaderboardOptions`, `LocalSandboxClientOptions`, `LoopDecisionPayload`, `LoopDispatchOptions`, `LoopEndedPayload`, `LoopIterationEndedPayload`, `LoopIterationStartedPayload`, `LoopPlanDescription`, `LoopResult`, `LoopSandboxPlacement`, `LoopStartedPayload`, `LoopTraceEmitter`, `LoopWinner`, `MaterializeLocalMcpOptions`, `McpEnvironmentOptions`, `McpToolDescriptor`, `NodeSnapshot`, `NoProgressForOptions`, `Observation`, `ObserveInput`, `ObserveOptions`, `OpenSandboxRunOptions`, `PairwiseOptions`, `PatchDeliverableOptions`, `PlacementInfo`, `PlateauOptions`, `ProgressTrackerOptions`, `PromotionGateOptions`, `PromotionVerdict`, `PublishOptions`, `ReproductionCheck`, `ResolveSandboxClientOptions`, `ResourceRequest`, `RollingDispatchOptions`, `RunAgenticOptions`, `RunAgentRoundsOptions`, `RunGraphOptions`, `SandboxRun`, `ShotSpec`, `SpawnOpts`, `StdioMcpConnection`, `StdioMcpServerSpec`, `SteerableSandboxArgs`, `Strategy`, `StrategyEvolutionConfig`, `StrategyResult`, `StreamAgentTurnOptions`, `StructuralRolloutConfig`, `SuperviseOptions`, `SuperviseSurfaceOptions`, `SupervisorAgentDeps`, `SupervisorOpts`, `SupervisorSpanOptions`, `SupervisorSpanRecorder`, `SurfaceScore`, `ToolSpec`, `ToolStepInput`, `TraceSource`, `TrajectoryAnalysis`, `UntrackedCopyStats`, `ValidationCtx`, `Validator`, `VerifierEnvironmentOptions`, `WatchTraceOptions`, `WaterfallCollector`, `WaterfallReport`, `WaterfallSpan`, `WorkerEvidenceInput`, `Workspace`, `WorkspaceRequest`, `WorkspaceRun`, `WorktreeCliExecutorOptions`, `WorktreeFanoutOptions`, `AgentEnvironmentStatus`, `AgentSessionStatus`, `ChampionPolicy`, `EdgeDeliveryOutcome`, `GraphEdge`, `LoopTraceEvent`, `MakeWorkerAgent`, `RepairStop`, `SandboxControlClient`, `WorkspaceCommit`.

### Environment provider adapters — generic sandbox/compute bridge

Import from `@tangle-network/agent-runtime/environment-provider` — 34 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `createAgentEnvironmentProviderRegistry` | function | Create a registry that resolves provider names to concrete provider instances. |
| `createTangleSandboxExactProcessProvider` | function | Adapt Tangle Sandbox's managed control runtime to Runtime's exact-process provider. |
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

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentEnvironment`, `AgentEnvironmentCapabilities`, `AgentEnvironmentEvent`, `AgentEnvironmentProvider`, `AgentEnvironmentQuery`, `AgentEnvironmentSummary`, `AgentSession`, `AgentSessionRef`, `AgentTurnInput`, `AgentTurnResult`, `CheckpointRef`, `CheckpointRequest`, `CreateAgentEnvironmentInput`, `CreateTangleSandboxExactProcessProviderOptions`, `ExecRequest`, `ExecResult`, `ForkRequest`, `PlacementInfo`, `ResourceRequest`, `WorkspaceRequest`, `AgentEnvironmentStatus`, `AgentSessionStatus`.

### Analyst loop — trace findings on a running loop

Import from `@tangle-network/agent-runtime/analyst-loop` — 14 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `iterationsToTraceStore` | function | Build an in-memory `TraceAnalysisStore` over a loop round's iterations. Fail-loud on an |
| `runAnalystLoop` | function | Analyze a run and apply accepted knowledge and agent-surface proposals. |
| `AnalystRegistryLike` | interface | Narrowed shape we accept for `AnalystRegistry` so the orchestrator |
| `AnalystRegistryStreamingLike` | interface | Narrow the `AnalystRegistryLike` further when we need streaming: the |
| `FindingsStoreLike` | interface | Narrowed shape we accept for `FindingsStore`. |
| `ImprovementProposalSource` | interface | Agent-surface bridge — proposes prompt, skill, tool, and scaffolding edits. |
| `KnowledgeProposalSource` | interface | Knowledge-side bridge — consumers wire `proposeFromFindings` from agent-knowledge. |
| `AnalystLoopEvent` | type | Events emitted by `runAnalystLoop` via `opts.onEvent`. UIs and |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `ImprovementEditBatch`, `ImprovementReport`, `KnowledgeProposalBatch`, `KnowledgeReport`, `RunAnalystLoopOpts`, `RunAnalystLoopResult`.

### Knowledge orchestration — supervised KB updates

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
| `uiAuditorProfile` | function | Preset `runAgentRounds` bundle for vision-driven UI audits: returns the `AgentRunSpec`, output adapter, validator, and prompt formatter the loop kernel needs. |
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

### PrimeIntellect: Verifiers package and trace adapter

Import from `@tangle-network/agent-runtime/primeintellect` — 29 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `createPrimeIntellectPackage` | function | Build a complete PrimeIntellect Verifiers package without writing to disk. |
| `importPrimeIntellectTraces` | function | Convert all Prime traces to agent-eval RunRecords while retaining one shared run config. |
| `parsePrimeIntellectTraces` | function | Parse Prime's durable `traces.jsonl` and reject malformed rows with a line number. |
| `primeIntellectExecutorConfig` | function | Resolve Prime's intercepted endpoint as transport-only Runtime executor configuration. |
| `primeIntellectTraceToRunRecord` | function | Project one complete Prime trace into the common agent-eval analysis row. |
| `readPrimeIntellectEpisodeContext` | function | Read and validate the private process contract installed by the generated Prime harness. |
| `runPrimeIntellectProgram` | function | Execute the caller's canonical runtime program inside a Prime rollout. |
| `writePrimeIntellectPackage` | function | Write a bundle through a sibling temporary directory, then rename it into place. |
| `PrimeIntellectPublicTask` | interface | The answer-free task exposed to the caller's runtime program. |
| `PrimeIntellectRunner` | interface | Files and commands that make the caller's real agent program runnable. |
| `PrimeIntellectTask` | interface | One immutable problem. References stay inside Prime's task process. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `PrimeIntellectEpisodeContext`, `PrimeIntellectPackageBundle`, `PrimeIntellectPackageManifest`, `PrimeIntellectPackageOptions`, `PrimeIntellectTrace`, `PrimeIntellectTraceImportOptions`, `PrimeTimeSpan`, `PrimeTraceNode`, `PrimeUsage`, `RunPrimeIntellectProgramOptions`, `WritePrimeIntellectPackageOptions`, `PrimeIntellectContent`, `PrimeIntellectImportDefaults`, `PrimeIntellectJson`, `PrimeIntellectMessage`, `PrimeIntellectScoring`, `PrimeIntellectSetupCommand`, `PrimeIntellectSplit`.

### Candidate execution — immutable prepare, run, grade, and receipt

Import from `@tangle-network/agent-runtime/candidate-execution` — 108 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `agentCandidateProfileAsAgentProfile` | function | Convert the candidate profile contract into the portable interface profile it represents. |
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
| `freezeGenericAgentCandidateProfile` | function | Convert only behavior-preserving generic profile fields into the closed candidate contract. |
| `omitUndefinedObjectFields` | function | Recursively remove undefined object fields while refusing undefined array entries. |
| `parseExactAgentProfile` | function | Parse a complete profile without silently discarding unsupported fields. |
| `parseExactAgentProfileDiff` | function | Parse a profile diff without silently discarding unsupported fields. |
| `parseExactCandidateProfile` | function | Parse a candidate profile without silently discarding unsupported or non-canonical fields. |
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
| `PersistedTaskOutcomeEvidence` | type | Immutable evaluator evidence retained with a verified candidate task outcome. |
| `VerifiedAgentCandidateTaskOutcome` | type | Branded task outcome that has survived independent evaluator verification. |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AgentCandidateContainerPort`, `AgentCandidateExecutionAttemptRef`, `AgentCandidateExecutionPorts`, `AgentCandidateExecutorWorkspaceFile`, `AgentCandidateExecutorWorkspaceInput`, `AgentCandidateMemoryPort`, `AgentCandidateMemoryResetResult`, `AgentCandidateModelPort`, `AgentCandidatePreparationEvidence`, `AgentCandidateProtectedModelActivation`, `AgentCandidateProtectedModelReservation`, `AgentCandidateProtectedModelSettlement`, `AgentCandidateProtectedRunCapture`, `AgentCandidateVerificationPorts`, `AgentCandidateWorkspaceArchiveLimits`, `CanonicalCandidateDocument`, `CaptureAgentCandidateWorkspaceOptions`, `CapturedAgentCandidateWorkspace`, `CreateAgentCandidateWorkspacePortOptions`, `CreateProtectedAgentCandidateModelPortOptions`, `DisposePreparedAgentCandidateOptions`, `ExactProcessCandidateExecutorOptions`, `ExecutePreparedAgentCandidateOptions`, `FileAgentCandidateExecutionClaimStoreOptions`, `InMemoryAgentCandidateExecutionClaimStoreOptions`, `PrepareAgentCandidateExecutionOptions`, `PreparedAgentCandidateExecution`, `PreparedAgentCandidateInstruction`, `PreparedAgentCandidateLaunch`, `PreparedAgentCandidateTrace`, `RecoverExpiredAgentCandidateOptions`, `ResolvedAgentCandidateContainer`, `VerifiedAgentCandidate`, `AgentCandidateModelGrantActivateInput`, `AgentCandidateModelGrantReserveInput`, `AgentCandidateModelGrantSettleInput`, `AgentCandidateOutputPurpose`, `AgentCandidateRetryRejection`, `AgentCandidateRunFinalization`.

### Testing fixtures — validated Runtime wire records

Import from `@tangle-network/agent-runtime/testing` — 4 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `loadAgentImprovementProposalFixture` | function | Load an isolated, production-validated Runtime proposal for consumer tests. |
| `loadAgentProfileImprovementFixture` | function | Load an isolated profile proposal and its private activation state for consumer tests. |
| `AgentProfileImprovementFixture` | interface | Complete private state for exercising profile activation and restore in consumer tests. |
| `AgentProfileImprovementProposalFixture` | type | A proposal produced by Runtime's opaque profile-improvement path. |

### MCP servers — delegate / coordination / detached-session

Import from `@tangle-network/agent-runtime/mcp` — 211 exports.

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
| `createDelegationHistoryHandler` | function | Build the MCP tool handler that reads filtered past delegations from a `DelegationTaskQueue`. |
| `createDelegationStatusHandler` | function | Build the MCP tool handler that polls a `DelegationTaskQueue` for task status. |
| `createDelegationTraceCollector` | function | Build a `DelegationTraceCollector` that buffers loop-trace events and converts them to spans on settle. |
| `createDetachedTurnResumeDriver` | function | Build the `driveTurn`-backed {@link DelegationResumeDriver}. Each `tick()` |
| `createFleetWorkspaceExecutor` | function | Build an executor that resolves each delegated iteration to an existing |
| `createInProcessExecutor` | function | Build an in-process executor. Returns a {@link DelegationExecutor} whose `client.create()` |
| `createInProcessTransport` | function | In-process pair of `Readable` + `Writable` streams suitable for driving |
| `createKbGate` | function | Build a fail-closed KB gate. The returned function runs the built-in floor |
| `createMcpServer` | function | Stdio JSON-RPC MCP server exposing the delegation tools (`delegate`, `delegate_feedback`, `delegation_status`, `delegation_history`, optional `delegate_ui_audit`) to sandbox coding-harness agents. |
| `createMemoryToolServer` | function | Build the memory MCP server: `memory_search` (lexical top-k over the rows) |
| `createPropagatingTraceEmitter` | function | Create a LoopTraceEmitter that: |
| `createSiblingSandboxExecutor` | function | Wrap a raw sandbox SDK client so the kernel emits |
| `createStdioToolServer` | function | Build the generic stdio JSON-RPC tool server. |
| `createWorktree` | function | Checkout a fresh git worktree for a delegation run on a new branch under `variantsDir`. |
| `detachedSessionDelegate` | function | Build the sandbox-session coder delegate. It drives `runAgentRounds` against the project's |
| `detachedTurnEvents` | function | Synthesize the terminal event array a detached turn settles through. Shaped |
| `detectExecutor` | function | Pick the right executor for an MCP server invocation based on env vars. |
| `eventToSnapshot` | function | Project a `FeedbackEvent` down to the snapshot shape carried on |
| `formatDetachedSessionRef` | function | Encode ref parts into the JSON-safe string stored on the record: |
| `harnessSupportsReasoningEffort` | function | Whether the harness's native control can express this reasoning effort. Admission checks read |
| `hashIdempotencyInput` | function | Best-effort stable hash for use as `idempotencyKey`. Not cryptographic; |
| `localHarnessExecutable` | function | The CLI binary a harness id runs. The two are NOT the same string (`claude-code` runs `claude`), |
| `mcpToolsForRuntimeMcp` | function | Returns the queue-bound delegation tools projected into OpenAI Chat |
| `mcpToolsForRuntimeMcpSubset` | function | Subset filter — return only the projected tools whose `function.name` |
| `mergeTraceEnv` | function | Merge a spawned child's environment from lowest to highest precedence — ambient env, the |
| `parseCodexTokenUsage` | function | Parse and validate the one terminal usage event emitted by `codex exec --json`. |
| `parseDetachedSessionRef` | function | Parse a `detachedSessionRef` string back to parts; throws `ValidationError` on malformed input. |
| `parseMemoryItems` | function | Coerce an untrusted JSON array into validated `MemoryItem` rows. |
| `readMemoryItemsFile` | function | Read a memory store file: a JSON array, or JSONL (one `MemoryItem` per line). |
| `readTraceContextFromEnv` | function | Read trace context from a process environment (defaults to `process.env`). |
| `removeWorktree` | function | Remove a git worktree and delete its branch. Already-removed paths are harmless; every other |
| `resolveMemoryFromEnv` | function | Resolve the bin's memory from `AGENT_MEMORY_FILE` (durable store) and/or |
| `runDetachedTurn` | function | Dispatch one detached turn and advance it to a terminal state with |
| `runLocalHarness` | function | Spawn a local coding harness CLI as a subprocess + collect its output. |
| `settleDetachedCoderTurn` | function | Settle a completed detached coder turn through the same gate the streaming |
| `traceContextToEnv` | function | Build env vars to pass to a child subprocess so it inherits the current trace context. |
| `validateDelegateArgs` | function | Parse and validate raw MCP tool input into typed `DelegateArgs`; throws `TypeError` on bad input. |
| `validateDelegateFeedbackArgs` | function | Parse and validate raw MCP tool input into typed `DelegateFeedbackArgs`; throws `TypeError` on bad input. |
| `validateDelegateUiAuditArgs` | function | Parse and validate raw MCP tool input into typed `DelegateUiAuditArgs`; throws `TypeError` on bad input. |
| `validateDelegationHistoryArgs` | function | Parse and validate raw MCP tool input into typed `DelegationHistoryArgs`; throws `TypeError` on bad input. |
| `validateDelegationStatusArgs` | function | Parse and validate raw MCP tool input into typed `DelegationStatusArgs`; throws `TypeError` on bad input. |
| `DEFAULT_AWAIT_EVENT_TIMEOUT_MS` | const | Default ceiling for a single `await_event` block (ms). Chosen well under any reasonable remote |
| `DEFAULT_LOCAL_HARNESS` | const | The harness a caller gets when it expresses no preference. A composition-root default, not a |
| `DELEGATE_DESCRIPTION` | const | Human-readable description of the `delegate` MCP tool, injected into the tool manifest. |
| `DELEGATE_FEEDBACK_DESCRIPTION` | const | Human-readable description of the `delegate_feedback` MCP tool, injected into the tool manifest. |
| `DELEGATE_FEEDBACK_INPUT_SCHEMA` | const | JSON Schema for `delegate_feedback` tool arguments (`refersTo`, `rating`, `by`, optional fields). |
| `DELEGATE_FEEDBACK_TOOL_NAME` | const | MCP tool name for the `delegate_feedback` feedback-recording tool. |
| `DELEGATE_INPUT_SCHEMA` | const | JSON Schema for `delegate` tool arguments (`intent` + optional trace id). |
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
| `LOCAL_HARNESSES` | const | Every local harness, in table order — the one list `AGENT_RUNTIME_LOCAL_HARNESSES` and any |
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
| `AnalystFindingEvent` | interface | A trace-analyst result re-entered as a message on the bus (the `finding` event kind). |
| `AuthorizedDownMessage` | interface | Product-authorized continuation bytes. Returning a narrowed instruction replaces the proposed |
| `CodexExecutionEvidence` | interface | Zero-model-call evidence for the exact Codex process about to run. |
| `CodexExecutionFailureDiagnostic` | interface | Bounded, credential-redacted process context attached when reproducible Codex output fails |
| `CodexExecutionPolicy` | interface | Isolation settings asserted before a reproducible Codex run is allowed to start. |
| `CodexTokenUsage` | interface | Exact aggregate usage emitted by Codex's terminal `turn.completed` JSONL event. |
| `ContinuationInstruction` | interface | Durable authorization receipt written before a continuation reaches a worker. |
| `CoordinationTools` | interface | The supervisor-side toolbox returned by {@link createCoordinationTools}: the MCP tool |
| `DelegateArgs` | interface | Parsed `delegate` tool arguments. |
| `DelegateCodeConfig` | interface | Minimal `CoderTask` overrides exposed over the MCP wire. The full |
| `DelegateError` | interface | What killed a delegation, projected for the calling agent: the rejection's name and message. |
| `DelegateUiAuditRoute` | interface | Optional per-route capture spec the agent surfaces over the wire. |
| `DelegationRecord` | interface | Must be JSON-safe end to end (`args`, `result`, `error`, `feedback`) — |
| `DelegationResumeDriver` | interface | Re-attaches restored in-flight records to their detached runs. The queue |
| `DelegationTraceCollector` | interface | Per-delegation trace collector. Buffers `LoopTraceEvent`s per runId |
| `DelegationTraceSpan` | interface | One span of a delegation's compact trace. Flat (parent linkage by id), all |
| `DetachedSessionRefParts` | interface | Decoded `DelegationRecord.detachedSessionRef`. `sandboxId` is absent between |
| `DownMessageAuthorizationInput` | interface | Detached continuation bytes and exact worker identity presented to product authorization before |
| `DownMessageDeliveryAttempt` | interface | A durable marker written after authorization and immediately before Runtime calls `Scope.send`. |
| `DownMessageEvent` | interface | A parent→child delivery result (the down-leg): recorded for observability, never pulled back by |
| `DriveTurnCapableBox` | interface | The box surface detached turns need. `SandboxInstance` |
| `FleetHandle` | interface | Minimal `SandboxFleet` surface the fleet executor calls. Declared |
| `JsonRpcMessage` | interface | One JSON-RPC 2.0 request or notification. |
| `JsonRpcResponse` | interface | One JSON-RPC 2.0 response. |
| `McpToolDescriptor` | interface | A callable MCP tool exposed by either stdio server. |
| `McpTransport` | interface | Stdio-shaped transport used by the shared JSON-RPC server implementation. |
| `MemoryItem` | interface | One row of agent memory: a crisp lesson/fact with provenance. |
| `ResearchOutputShape` | interface | Provider-neutral research output carried over the MCP boundary. The MCP |
| `ResolvedMemoryEnv` | interface | What the memory bin resolved from its environment. |
| `SettledWorker` | interface | A worker the driver has drained via `await_event`. |
| `UiAuditorDelegationOutput` | interface | Wire-shape of a completed UI-audit delegation. The `findings` array |
| `WorkerSpawnContext` | interface | Immutable task, allocation, identity attribution, and semantic key supplied while a manager's |
| `WorkerWatchOptions` | interface | Online-detector wiring for spawned workers (`CoordinationToolsOptions.watchWorkers`). |
| `AuthorizeDownMessage` | type | Product decision over an exact continuation before it is durably recorded or delivered. |
| `CoderReviewer` | type | Optional adversarial reviewer over a coder candidate that already passed |
| `CoordinationEvent` | type | Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for |
| `DelegateResult` | type | The synchronous result the `delegate` tool returns to the calling agent: the delivered output (or |
| `DelegationArgs` | type | Arguments accepted by the durable delegation queue. |
| `DelegationResultPayload` | type | Polymorphic `result` field: `CoderOutput` when the underlying profile |
| `DelegationResumeTick` | type | One observation of a detached run, mapped 1:1 from a single-tick driver |
| `DownMessageDeliveryOutcome` | type | The exact result of one parent→child delivery attempt. |
| `DriveTurnTick` | type | Structural mirror of the sandbox SDK's `TurnDriveResult` (>= 0.6). |
| `GitRunner` | type | Pluggable git runner (sync) — replaceable in tests. |
| `LocalHarness` | type | Local coding harness available inside the sandbox — a narrowing of the shared `HarnessType` |
| `UiAuditorDelegate` | type | UI-auditor delegate — fully consumer-injected. agent-runtime ships no |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AnalystRegistry`, `CappedDelegationTrace`, `CoderOutput`, `CoderReview`, `CoordinationToolsOptions`, `CreateKbGateOptions`, `CreateMemoryToolServerOptions`, `CreateWorktreeOptions`, `DelegateCodeArgs`, `DelegateCodeResult`, `DelegateFeedbackArgs`, `DelegateFeedbackHandlerOptions`, `DelegateFeedbackResult`, `DelegateHandlerOptions`, `DelegateResearchArgs`, `DelegateResearchConfig`, `DelegateResearchResult`, `DelegateRunCtx`, `DelegateUiAuditArgs`, `DelegateUiAuditConfig`, `DelegateUiAuditHandlerOptions`, `DelegateUiAuditResult`, `DelegationError`, `DelegationExecutor`, `DelegationFeedbackSnapshot`, `DelegationHistoryArgs`, `DelegationHistoryEntry`, `DelegationHistoryHandlerOptions`, `DelegationHistoryResult`, `DelegationProgress`, `DelegationResumeContext`, `DelegationRunContext`, `DelegationStatusArgs`, `DelegationStatusHandlerOptions`, `DelegationStatusResult`, `DelegationStore`, `DelegationTaskQueueOptions`, `DelegationTraceCaps`, `DetachedSessionDelegateOptions`, `DetachedTurn`, `DetachedTurnResumeDriverOptions`, `DetectExecutorArgs`, `DiffOptions`, `DiffResult`, `FactCandidate`, `FactJudge`, `FactJudgeVerdict`, `FeedbackEvent`, `FeedbackRating`, `FeedbackRefersTo`, `FeedbackStore`, `FileDelegationStoreOptions`, `FleetWorkspaceExecutorOptions`, `InProcessExecutorDescribePlacement`, `InProcessExecutorOptions`, `KbGateResult`, `LocalHarnessResult`, `McpServer`, `McpServerOptions`, `Question`, `QuestionOption`, `QuestionRecord`, `RemoveWorktreeOptions`, `RunDetachedTurnOptions`, `RunLocalHarnessOptions`, `SettleDetachedCoderTurnOptions`, `SiblingSandboxExecutorOptions`, `StdioToolServer`, `StdioToolServerOptions`, `SubmitInput`, `SubmitOutput`, `TraceContext`, `WorktreeHandle`, `CoderDelegate`, `DelegationProfile`, `DelegationStatus`, `DetachedWinnerSelection`, `MakeWorkerAgent`, `QuestionDecision`, `QuestionLevel`, `QuestionPolicy`, `QuestionUrgency`, `ResearchSource`, `UiAuditLensFilter`.

### Supervisor TUI — live terminal view over the on-disk run layout

Import from `@tangle-network/agent-runtime/tui` — 18 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `loadTopSnapshot` | function | Read every supervisor run under one workspace into a single point-in-time snapshot. |
| `renderTopFrame` | function | Render one snapshot to an ANSI frame. Use this when nothing needs to be clickable. |
| `renderTopFrameWithLayout` | function | Render one snapshot, returning the frame together with the row→entity map a mouse click resolves |
| `renderTopOnce` | function | Render exactly one frame and return it. This is the non-interactive path — `--once`, a pipe, a |
| `runTopApp` | function | Run the TUI. With a TTY on both ends and no `--once` this takes over the terminal until `q`; |
| `TopSnapshot` | interface | The read side of the supervisor-run TUI: turn the on-disk run layout into one `TopSnapshot`, and |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `BudgetStats`, `Distribution`, `RenderedTopFrame`, `RenderOptions`, `RenderTarget`, `SpendStats`, `SupervisorBase`, `SupervisorTotals`, `SupervisorView`, `TopAppOptions`, `WorkerView`, `TopJournalEvent`.

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

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `Finding`, `VerifyOptions`, `LayerStatus`.

### STATISTICS — significance, intervals, effect size

Import from `@tangle-network/agent-eval` — 61 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `benjaminiHochberg` | function | Benjamini–Hochberg false discovery rate. Returns adjusted q-values and |
| `bonferroni` | function | Bonferroni adjustment: multiply every p-value by the test count, clamp at 1. |
| `cliffsDelta` | function | Cliff's delta — a non-parametric effect size for two independent samples. |
| `cohensD` | function | Cohen's d — standardized effect size for two independent groups. |
| `confidenceInterval` | function | Percentile bootstrap confidence interval on the mean of `scores`. |
| `corpusInterRaterAgreement` | function | Corpus-wide inter-rater agreement across N items × M judges × D dimensions. |
| `corpusInterRaterAgreementFromJudgeScores` | function | Convenience adapter for `JudgeScore[]` data keyed externally by item. |
| `eProcess` | function | Betting test-martingale for bounded observations — the e-process core of |
| `interpretCliffs` | function | Map a Cliff's delta to a qualitative magnitude using the standard |
| `interRaterReliability` | function | Inter-rater reliability — Krippendorff's α under the squared-difference |
| `mannWhitneyU` | function | Mann-Whitney U — two independent samples, no distributional assumption. |
| `mcnemar` | function | McNemar's test for paired binary outcomes — the correct significance test for |
| `mcnemarPower` | function | Power of a McNemar test at a given number of paired observations, the inverse |
| `mcnemarRequiredN` | function | Number of paired observations needed for a McNemar test to reach a target |
| `mulberry32` | function | Tiny seedable PRNG (mulberry32) — deterministic resampling/shuffling, not |
| `pairedBinaryScale` | function | The common positive level `s` such that EVERY value across both paired arms is |
| `pairedBootstrap` | function | Paired bootstrap on (after − before) deltas. Returns a CI on the chosen |
| `pairedCohensDz` | function | Cohen's dz for paired observations: mean(after - before) divided by the |
| `pairedDecisionShape` | function | Which estimator {@link decidePairedPromotion} would use on this data, and the |
| `pairedDeltaTest` | function | Tests whether a paired candidate-minus-baseline delta clears a threshold. |
| `pairedDeltaTieFraction` | function | Fraction of paired observations whose delta is an exact tie (\|after − before\| |
| `pairedEvalueSequence` | function | Run the paired e-value sequence over an in-order delta stream. |
| `pairedMde` | function | Minimum detectable paired effect (standardised units) for a target paired |
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
| `normalizeScores` | const | Identity: dimensions already follow "higher = better" by prompt convention |
| `ExactRiskDifferenceResult` | interface | A paired binary effect size with an EXACT interval and the exact test that |
| `McNemarResult` | interface | Result of a McNemar paired-binary significance test. |
| `PairedMcNemarEvidence` | interface | McNemar's exact paired-binary evidence, on the two-point path only. |
| `ProportionInterval` | interface | A binomial proportion estimate with a confidence interval. |
| `RiskDifferenceResult` | interface | A paired binary effect size (treatment rate − control rate) with a CI. |
| `ScoreRiskDifferenceResult` | interface | A paired binary effect size with an interval that is valid at a NONZERO |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `BootstrapOptions`, `BootstrapResult`, `ClusterBootstrapInterval`, `CorpusAgreementOptions`, `CorpusAgreementPerDimension`, `CorpusAgreementReport`, `CorpusScoreRecord`, `EProcess`, `EProcessOptions`, `EProcessState`, `EProcessStep`, `PairedBootstrapOptions`, `PairedBootstrapResult`, `WeightedCompositeInput`, `WeightedCompositeResult`, `CliffsMagnitude`.

### CAMPAIGN — profile matrix, gates, improvement loop

Import from `@tangle-network/agent-eval/campaign` — 353 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `acquireSingleRunLock` | function | Acquire the lock or throw naming the live holder. A stale lock (holder pid |
| `analyzeCrossSurfaceInteractions` | function | Build the complete cross-surface evidence matrix and derive all three frozen |
| `assertCampaignDesign` | function | Reject campaign designs whose denominator cannot be identified exactly. |
| `assertCampaignSplitIdentity` | function | Refuse a campaign whose retained task identities contradict its split digest. |
| `assertCodeSurfaceIdentity` | function | Validate the immutable identity shape; the owning executor verifies the Git objects and patch. |
| `assertComponentSurface` | function | Assert that a value is a valid non-empty component surface. |
| `autoevalsScorerJudge` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `buildEvidenceVector` | function | The Evidence Bus. For each objective, pair candidate vs baseline by full |
| `buildLoopProvenanceRecord` | function | Build the durable provenance record from a completed loop result. |
| `buildTraceAnalystSurfaceDispatch` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `campaignBreakdown` | function | Per-candidate evidence a reflective/patch proposer grounds its next proposal |
| `campaignMeanComposite` | function | Mean composite across cells with complete task-quality evidence. |
| `campaignMeasurementDigest` | function | Digest the exact campaign fields that can affect a measured comparison. |
| `campaignScenarioIdentity` | function | Redacted but independently verifiable identity of one complete scenario. |
| `campaignSplitDigest` | function | Canonical identity of the exact scenario payloads and replicate count. |
| `campaignSplitDigestFromIdentities` | function | Canonical split identity reconstructed from redacted scenario identities. |
| `canonicalDigest` | function | Return the canonical SHA-256 digest of a JSON-serializable value. |
| `classifyUngroundedLiterals` | function | Scan revised artifact text for single-quoted single-word literals (the |
| `codeSurfaceIdentityMaterial` | function | Canonical, location-independent identity of a finalized code candidate. |
| `combineComparisonCosts` | function | Combine method costs without turning one unknown bill into a known total. |
| `compareOptimizationMethods` | function | Compare complete optimization methods on disjoint train, selection, and final test data. |
| `compareRankKeys` | function | Compare fixed-length lexicographic rank keys where each element is higher-is-better. |
| `componentSurfaceIdentityMaterial` | function | Return deterministic identity material independent of component key order. |
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
| `fsCampaignStorage` | function | Node-filesystem storage — the default. Lazily requires `node:fs` so the |
| `gepaOptimizationMethod` | function | Turn an optional GEPA installation into an `OptimizationMethod`. |
| `gitWorktreeAdapter` | function | Git-backed `WorktreeAdapter`: creates isolated worktrees on fresh branches, commits agent changes, and discards losers. |
| `heldOutGate` | function | Composable held-out gate: ships only when the lower bound of the DECIDING |
| `heldoutSignificance` | function | Significance of the held-out composite lift: ship only when the lower bound |
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
| `makeProposalFinding` | function | Build a finding whose source is explicitly allowed during candidate generation. |
| `neutralizationGate` | function | Composable placebo gate: ships only when the candidate's held-out lift is NOT |
| `neutralizeText` | function | Blank every non-whitespace character to a 1-byte filler while preserving all |
| `openAutoPr` | function | Open a GitHub PR for a gate-approved surface promotion, attaching the manifest hash, gate verdict, and diff as the PR body. |
| `openSearchLedger` | function | Open a durable filesystem search ledger. Construction performs no I/O; the |
| `optimizationTokenUsageFromSummary` | function | Preserve every optimizer token class while keeping total input and output explicit. |
| `pairHoldout` | function | Pair candidate vs baseline holdout observations by FULL cellId. `select` |
| `paretoSignificanceGate` | function | Wrap the bus + a policy as a `Gate`. Plugs into the existing |
| `phoenixEvaluatorJudge` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `planCampaignRun` | function | Plan a campaign WITHOUT dispatching: computes the manifest hash and the per-cell |
| `planEvalFixtureRun` | function | Dry-run planner for a fixture campaign: loads the scenarios, delegates to `planCampaignRun`, |
| `powerPreflight` | function | Estimate the minimum detectable lift a paired-holdout improvement run can |
| `provenanceRecordPath` | function | Canonical durable paths under the run dir. |
| `provenanceSpansPath` | function | Canonical path for the durable OTLP spans JSONL file under a loop run directory. |
| `renderScoreboardMarkdown` | function | Render the scoreboard as a launch-readiness Markdown document — the literal |
| `renderSurfaceDiff` | function | Canonical customer-visible description of the exact before/after surfaces. |
| `resolveExternalOptimizerCallbackLimits` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `resolveExternalOptimizerProcessLimits` | function | _(no summary — add a TSDoc line at the declaration)_ |
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
| `traceAnalystQualityJudge` | function | _(no summary — add a TSDoc line at the declaration)_ |
| `userStoryScoreboard` | function | Flatten story verdicts into the per-requirement scoreboard — the literal |
| `validateSearchLedgerEvent` | function | Validate and return a canonical copy. Arrays whose order is not semantic are |
| `verifyCodeSurface` | function | Verify a finalized code surface against its current checkout. This rejects |
| `verifyLoopProvenanceRecord` | function | Recompute and validate the self-addressed durable record. |
| `DEFAULT_EXTERNAL_OPTIMIZER_CALLBACK_LIMITS` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `DEFAULT_EXTERNAL_OPTIMIZER_PROCESS_LIMITS` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `paretoPolicy` | const | The default strategy: symmetric multi-objective Pareto significance. Ship iff |
| `SEARCH_LEDGER_SCHEMA` | const | _(no summary — add a TSDoc line at the declaration)_ |
| `FileSearchLedger` | class | Append-only file-backed search ledger with idempotent writes and replay. |
| `FsLabeledScenarioStore` | class | Filesystem `LabeledScenarioStore`: appends one JSONL file per source with provenance and |
| `LabeledScenarioStoreError` | class | Typed rejection from a labeled-scenario store (bad provenance, rate limit, invalid sample args) — carries a stable string `code`. |
| `ProfileMatrixError` | class | Thrown when the matrix is misconfigured (no profiles, a profile whose model |
| `SearchLedgerConflictError` | class | Error raised when an event identifier is reused with different content. |
| `SearchLedgerError` | class | Base error for invalid search-ledger input or operations. |
| `SearchLedgerIntegrityError` | class | Error raised when durable search-ledger data fails an integrity check. |
| `WorktreeAdapterError` | class | Typed failure from a `WorktreeAdapter` operation (create/finalize/discard) — wraps the underlying git error as `cause`. |
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
| `ExternalOptimizerModelCallRequest` | interface | One exact model request admitted by the loopback proxy. |
| `ExternalTextOptimizationMethodConfig` | interface | Configuration for adapting another text optimizer. |
| `Gate` | interface | Composable promotion gate. |
| `GenerationCandidate` | interface | One scored candidate surface in a generation. `dimensions` + `scenarios` |
| `GepaEngineOptions` | interface | Shared settings for one bounded GEPA engine invocation. |
| `GepaEngineRun` | interface | One independently budgeted GEPA engine invocation. |
| `JudgeConfig` | interface | Pluggable dimensional scorer. `score` is the contract: |
| `JudgeScore` | interface | The canonical judge verdict shape — one declaration, shared by campaign |
| `LabeledScenarioWrite` | interface | Required-provenance write. The store rejects writes that |
| `LoopProvenanceRecord` | interface | The durable provenance record. Aligns to the hosted `EvalRunEvent` path but |
| `OpenAICompatibleOptimizerModel` | interface | One metered model path supplied by the package that owns execution. |
| `OptimizationMethod` | interface | A complete optimization method, including candidate generation and selection. |
| `OptimizationMethodInput` | interface | Shared inputs for one optimization method. Final test data is absent. |
| `ParetoParent` | interface | A non-dominated parent on the GEPA Pareto frontier — a |
| `PlaybackContext` | interface | Dispatch context plus the profile under test (which cheap model, etc.). |
| `PlaybackDriver` | interface | Drives the real product through a story and returns the runtime event stream |
| `PlaybackStep` | interface | One step of a user story — what the user does. The driver interprets |
| `PowerPreflightOptions` | interface | Power preflight — "can this budget detect the effect you are hunting?" |
| `ProposalTrackContext` | interface | The lineage track that requested a proposal. |
| `ProposeContext` | interface | Search state supplied to one candidate-generation call. |
| `ProposedCandidate` | interface | A proposer output carrying the surface AND the WHY behind |
| `RolloutCall` | interface | One tool/action call observed in a rollout: a name plus its arguments. |
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
| `DispatchFn` | type | One function: scenario + ctx → artifact. Dispatcher chooses |
| `ExternalOptimizerChatRequest` | type | Provider-neutral request parsed once from the optimizer's loopback protocol. |
| `ExternalOptimizerEvaluationObservation` | type | Durable callback-side record of every candidate submitted for scoring, |
| `ExternalOptimizerModelCall` | type | Execution-neutral model-call seam for an external optimizer. |
| `ExternalOptimizerModelCallResult` | type | Runtime-owned result for one admitted optimizer-model call. |
| `ExternalOptimizerModelExecutionObservation` | type | One opaque Runtime execution record retained for one admitted model call. |
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
| `SearchLedgerTrustedHeadMode` | type | How this ledger uses its trusted head — the `(sequence, entryHash)` pin kept |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `AnalyzeCrossSurfaceInteractionsInput`, `AutoevalsScoreLike`, `AxisEvidence`, `BuildEvidenceVectorOptions`, `BuildLoopProvenanceArgs`, `BuildTraceAnalystSurfaceDispatchOptions`, `CampaignAggregates`, `CampaignBreakdown`, `CampaignCellResult`, `CampaignResult`, `CampaignRunPlan`, `CampaignRunPlanCell`, `CodeSurfaceVerification`, `CompareOptimizationMethodsOptions`, `CrossSurfaceAdditionDecision`, `CrossSurfaceBestSingleSelection`, `CrossSurfaceBootstrapPolicy`, `CrossSurfaceCandidateComparison`, `CrossSurfaceCandidateEvidence`, `CrossSurfaceCandidateOutcome`, `CrossSurfaceCandidateSummary`, `CrossSurfaceCompositionStep`, `CrossSurfaceDistribution`, `CrossSurfaceEligibility`, `CrossSurfaceEvidenceBreakdown`, `CrossSurfaceInteractionAwareSelection`, `CrossSurfaceInteractionEffect`, `CrossSurfaceInteractionReport`, `CrossSurfaceInteractionTask`, `CrossSurfaceNaiveStackSelection`, `CrossSurfacePairCompatibility`, `CrossSurfacePairEvidence`, `CrossSurfacePairwiseEntry`, `CrossSurfaceRankedSingle`, `CrossSurfaceRelativeCost`, `CrossSurfaceSelections`, `DefaultProductionGateOptions`, `DimensionRegression`, `DiscriminationScore`, `EmitLoopProvenanceArgs`, `EmitLoopProvenanceResult`, `EvalFixture`, `EvalFixtureFile`, `EvalFixtureLoadOptions`, `EvalFixtureScenario`, `EvidenceVector`, `ExternalOptimizationExample`, `ExternalOptimizerCallbackLimits`, `ExternalOptimizerExecutionSummary`, `ExternalOptimizerModelBudget`, `ExternalOptimizerObservationSummary`, `ExternalOptimizerProcessLimits`, `ExternalOptimizerRunnerCommand`, `ExternalTextEvaluationResponse`, `ExternalTextOptimizerContext`, `ExternalTextOptimizerResult`, `FsLabeledScenarioStoreOptions`, `GateContext`, `GateContribution`, `GateResult`, `GenerationRecord`, `GepaOptimizationMethodConfig`, `GitWorktreeAdapterOptions`, `HeldOutGateOptions`, `HeldoutSignificance`, `HeldoutSignificanceOptions`, `JudgeAggregate`, `JudgeDimension`, `LabeledScenarioRecord`, `LabeledScenarioSampleArgs`, `LabeledScenarioStore`, `LlmJudgeOptions`, `LoadEvalFixtureScenariosOptions`, `LoopProvenanceArgsFromResult`, `LoopProvenanceBackend`, `LoopProvenanceCandidate`, `LoopProvenanceEvidence`, `LoopProvenanceOptimizationMethod`, `NeutralizationGateOptions`, `OpenAutoPrOptions`, `OpenAutoPrResult`, `OpenSearchLedgerOptions`, `OptimizationMethodComparison`, `OptimizationMethodPairwise`, `OptimizationMethodProvenance`, `OptimizationMethodResult`, `OptimizationMethodScore`, `OptimizationPackageSource`, `OptimizationTokenUsage`, `OptimizerConfig`, `PairedHoldout`, `ParetoSignificanceGateOptions`, `PendingCostCallView`, `PhoenixEvaluationResultLike`, `PhoenixEvaluatorLike`, `PlanCampaignRunOptions`, `PlanEvalFixtureRunOptions`, `PowerPreflight`, `PremeasuredOptimizationBaseline`, `ProfileSummary`, `PromotionObjective`, `ReferenceEquivalenceJudgeOptions`, `ReferenceEquivalenceScenario`, `RolloutArgumentDiff`, `RolloutArgumentDiffOptions`, `RunCampaignOptions`, `RunEvalOptions`, `RunImprovementLoopResult`, `RunOptimizationResult`, `RunProfileMatrixOptions`, `RunProfileMatrixResult`, `ScenarioAggregate`, `ScenarioRollup`, `ScoreboardRenderOptions`, `SearchAttemptAccounting`, `SearchCandidateDecidedEvent`, `SearchCandidateLineage`, `SearchCandidateRegisteredEvent`, `SearchCandidateSlot`, `SearchCandidateSlotClosedEvent`, `SearchCandidateSurface`, `SearchCompletedEvent`, `SearchFailureReason`, `SearchLedger`, `SearchLedgerAppendResult`, `SearchLedgerEntry`, `SearchLedgerReplay`, `SearchModelIdentity`, `SearchOperationRecordedEvent`, `SearchPlan`, `SearchPlannedEvent`, `SearchPlannedOperation`, `SearchPlannedTask`, `SearchTaskAttemptedEvent`, `SequentialDecideFn`, `SequentialDecideOptions`, `SequentialObservation`, `SequentialPairedGate`, `SequentialPairedGateOptions`, `SingleRunLock`, `SkillOptOptimizationMethodConfig`, `SkillOptTrainerConfig`, `TraceAnalystArtifact`, `TraceAnalystScenario`, `TraceSpan`, `UngroundedLiteralReport`, `Worktree`, `WorktreeAdapter`, `AutoevalsScorerLike`, `CrossSurfaceAdditionRejectionReason`, `CrossSurfaceIneligibilityReason`, `CrossSurfacePairIncompatibilityReason`, `DefaultProductionGateCheck`, `DefaultProductionRewardHackingOptions`, `EvalFixtureRunPlan`, `EvalFixtureValidationMode`, `ExternalOptimizerEndpointFormat`, `ExternalOptimizerEvaluationRefusalReason`, `OptimizerModelBudget`, `RedactionStatus`, `RunImprovementLoopOptions`, `RunOptimizationOptions`, `SearchAccountingAudit`, `SearchCostAccounting`, `SearchLedgerEvent`, `SearchLedgerHash`, `SearchOperationKind`, `SearchSurfaceEffect`, `SearchSurfaceKind`, `SearchTaskOutcome`, `SearchTokenAccounting`, `SequentialDecision`, `SkillOptRunnerCommand`.

### TOKEN / USAGE — usage extraction + run-record usage types

Import from `@tangle-network/agent-eval` — 5 exports.

| Symbol | Kind | Summary |
|---|---|---|
| `extractUsage` | function | Pull `{ input, output, cached?, cacheWrite? }` from a parsed response |
| `extractUsageFromResponse` | function | Extract usage from an HTTP `Response` without consuming the caller's body: |
| `extractUsageFromSse` | function | Extract token usage from a complete SSE response body using the shared SSE |

**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): `LlmUsage`, `RunTokenUsage`.
