# Changelog

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
