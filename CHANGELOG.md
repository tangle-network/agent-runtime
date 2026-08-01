# Changelog

## Unreleased

- Three release checks no longer infer concurrency or process readiness from sub-second wall-clock sleeps; they wait for the event under test or allow their real container/process boundary to start.

## 0.119.0

### No harness is special: eleven name branches become table rows

BREAKING. `LocalHarness` was a private three-member vocabulary (`'claude' | 'codex' | 'opencode'`) that spelled one harness differently from every other layer in the stack. It is now a narrowing of the shared `HarnessType`: **`'claude'` is renamed to `'claude-code'`**. `claude` remains the EXECUTABLE name and lives only in the harness table's `command` field.

Callers to update: `runLocalHarness({ harness })`, `harnessInvocation(harness, …)`, `runWorktreeHarness({ harness })`, `agenticGenerator({ harness })`, `driverLoopGenerator({ harness })`, `createInProcessExecutor({ harnesses })`, `AuthoredHarness.harness`, and the `AGENT_RUNTIME_LOCAL_HARNESSES` env list. Anything that passed `'claude'` passes `'claude-code'`; `codex` and `opencode` are unchanged.

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
>>>>>>> origin/main

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
