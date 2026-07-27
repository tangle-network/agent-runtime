# `@tangle-network/agent-runtime`: Canonical API Reference

<!-- This file maps common jobs to the right public API.
Generated signatures and the complete export list live in docs/api/.
Run pnpm docs:freshness after editing this file. -->

> **Version 0.106.0.**
> [`docs/api/primitive-catalog.md`](./api/primitive-catalog.md) lists every export and import path.
> `agent-eval` must satisfy `>=0.130.1 <0.131.0`.
> `sandbox` must satisfy `>=0.13.0-0 <0.14.0`.
> Portable profile and tool-part types come from `@tangle-network/agent-interface` `>=0.35.0 <0.36.0`.
>
> **`./loops` is the runtime barrel**: `package.json` maps it to `src/runtime/index.ts`. Everything below labelled `/loops` is the recursive-atom + loop-kernel surface.
>
> **Read this before writing any orchestration, optimization, or measurement code in this repo.** If you are about to write a persona⟷agent conversation runner, a "skill optimizer", a "profile-seam", a depth-vs-breadth A/B harness, a bootstrap loop, or a `new Sandbox(...)` + stream + read dance: **stop**, it already exists, and a parallel copy will silently break one of the guarantees the existing primitives enforce: equal compute per compared arm ("equal-k"), the attempt-picker never being the grader ("selector≠judge"), complete usage capture, or eval running the same code path as production.

## 1. Mental model: the spine

> **Legend**: five terms the rest of this doc leans on, in plain terms:
> - **profile**: an `AgentProfile`: the whole agent as data (prompt + skills + tools + mcp + knowledge/memory). Internal design docs also call this the agent's "genome".
> - **driver ⟷ worker**: one agent (the driver) spawns and steers other agents (workers) and reads their output; both are the same building block playing different roles.
> - **conserved budget pool**: one shared compute budget split across workers, so two different topologies cost the same and a comparison is fair.
> - **combinator**: a reusable topology shape (`loopUntil` = depth/refine, `fanout` = breadth/sample) you compose instead of hand-writing a loop.
> - **holdout**: fresh problems held back from tuning, so a measured win can't be memorization.

The system is four steps, each with a named entry point:

1. **Describe the agent as data.** A **profile** is the whole agent: `systemPrompt + skills + tools + mcp + knowledge + memory + rag`, one combined surface.
2. **Run it.** A driver steers workers over rounds: `runPersonified` composes a combinator (`loopUntil`, `fanout`, …) over the `Supervisor`, spending K rounds against one persistent, journaled artifact from a *conserved budget pool*, so any two topologies you compare cost the same by construction.
3. **Score it on a benchmark.** Either the `ADAPTERS` registry driven by `runGate` over the Supervisor, or an `AgenticSurface` driven by `runBenchmark`/`runAgentic`.
4. **Improve it on three partitions.** `improve(profile, { executionRef, method, trainScenarios, selectionScenarios, testScenarios, agent })` runs a complete agent-eval `OptimizationMethod`. The method receives train and selection cases only. Runtime materializes each surface as a complete detached profile and passes that exact profile to `agent`. `executionRef` identifies the callback, component mapping, model, tools, and closure settings. Agent Eval scores the selected profile on the untouched final test. Runtime returns `ship` only when the paired interval clears the required lift and all spend is accounted for.

Two standing rules: the model that picks the best attempt is never the model that grades it, and observation attaches to the *loop* via `RuntimeHooks`, never to the portable profile. One known limit: the current `Supervisor` records completed settlements but does not resume a live tree after coordinator restart.

(The original one-sentence compressed form of this spine is preserved in [design.md](./design.md).)

Two substrates implement the same recursive-atom over the one `Executor` port and share `defaultSelectWinner`: a deliberate pair, **do not invent a third**.
The reactive `Supervisor`/`Scope` plus personify combinators drive dynamic agent trees; the round-synchronous `runAgentRounds` kernel is one leaf backend.
`inlineSandboxClient` adapts any non-box `Executor` into a `SandboxClient` for `runAgentRounds`, and `settledToIteration` bridges reactive `Settled` results into the kernel's `Iteration`.
`runAgentRounds` was named `runLoop`, which remains a deprecated `/loops` alias.
It is separate from root `runToolLoop` and `streamToolLoop`, which run one chat turn and fold tool calls back into it.

## 1.5 The AgentProfile rule: author the profile, the substrate materializes it

An `AgentProfile` contains the agent's system prompt, skills, tools, MCP servers, subagents, hooks, permissions, memory, retrieval configuration, and model settings.
Skills remain separate resources that the runtime can invoke; do not concatenate them into the system prompt.

**You change an agent's behavior by changing its PROFILE: never by writing orchestration code around it.** The behaviors we keep hand-rolling are profile properties:
- **Self-verification** is a profile lever, three ways, all configuration and zero glue code: (1) *steered*: the prompt says "run the tests, read failures, fix, repeat"; (2) *process-defined*: its instructions make verify-after-every-change its standing process; or (3) a **post-finish hook** that auto-runs the check and feeds failures back. The harness runs that loop. **You do not write a per-round judge, a `while(!done)`, or a bash hill-climb.**
- **Iteration, delegation, audit-against-spec** are likewise hooks / subagents / skills / process *in the profile*.

**The sandbox substrate materializes a profile into the harness's real shapes: so author the GENERAL profile and NEVER code to a harness.** `@tangle-network/sandbox` renders an `AgentProfile` into whatever the running harness needs (instructions file, tool/MCP config, mounted skills, hooks, subagents). opencode / Claude Code / Codex are interchangeable *targets*; opencode is only the local **test** substrate behind the cli-bridge. **Do NOT write harness-specific config or a `profile → opencode.json` realizer.** A lever that isn't materialized yet is a **substrate gap to fill in `@tangle-network/sandbox`**, not a bespoke realizer here.

**Therefore the supervisor's only intelligence is AUTHORING full profiles**: the optimizable self-improvement surface: read the task, decompose it, and for each sub-task author the *complete* profile (which prompt, skills, tools/MCP, hooks, subagents, model). The quality of a worker IS the quality of the profile authored for it. **The harness executes; you compose.**

## 2. Decision table: "I want to ___ → use ___ → NOT ___"

This table is judgment-only: it maps an intent to the ONE primitive to reach for and the thing NOT to build. It is not an inventory: **for the full list of what exists (every export, its import path, its one-line summary) see the generated `docs/api/primitive-catalog.md`; for full signatures, the per-module `docs/api/` pages.** Each row tags its import subpath; a row is a LOCAL export of this package unless tagged with a substrate package (`agent-eval/contract`, `agent-eval/campaign`, `@tangle-network/sandbox`) or `bench`.

### "A loop" is not one thing: read this before reaching for one

A general "loop" primitive is the single most common modelling error in this repo; it has produced a `defineLoop` facade **twice** (see [`research/loop-facade-postmortem.md`](./research/loop-facade-postmortem.md)). "Iterate agents toward a goal" splits on **one question: is the structure FIXED (you write the shape, it's code) or DYNAMIC (a model decides the shape at runtime)?** How many agents (1 vs N) is *orthogonal*: every shape below is 1..N agents, so "two agents (proposer→verifier)" is not special, it's a 2-stage chain.

**FIXED shape → a combinator you compose:**

| You want… | Shape | Use (`/loops`) |
|---|---|---|
| refine ONE artifact over rounds until a check passes | depth | `loopUntil` |
| try N independent attempts, keep the best | breadth | `fanout` |
| ordered stages, each feeds the next: this is what "propose → verify" is | chain | `pipeline` |
| many independent views of one artifact, then aggregate | ensemble | `panel` |
| expand only the promising branches | adaptive search | `widen` + `flatWidenGate` |

**DYNAMIC shape → this is orchestration, NOT a loop.** When an LLM decides *at runtime* what to spawn next and when to stop (decompose a messy goal, react to each result, no fixed round count), it is a reactive tree, not a loop: `Scope` + Supervisor in-process (`supervise` / `runPersonified`), or `createCoordinationTools` for a sandbox driver. Its topology is *data*, so no fixed-round "loop" grammar can describe it.

**The trap** is a single grammar (`defineLoop`, a `runXxxLoop`) spanning all of the above: there can't be one, because some are code and one is a model deciding. No new loop primitive lands without a tiny executable proof, **over real agents**, of the exact substrate join it claims to simplify.

| I want to… | Use (import) | Do NOT build |
|---|---|---|
| Run a supervisor toward a goal with default setup | `supervise(profile, task, { budget, backend? })`: `/loops` | hand-wiring `createSupervisor().run` + `blobs`/`perWorker`/`journal`/`executors`; reaching for lower-level calls before you need a specific counterparty |
| **Supervise agents to solve a graded `AgenticSurface` task** (workers `runAgentic` the surface, settle on its own check, driver self-improves from the failing tests) | `superviseSurface(profile, task, { surface, worker })`: `/loops` | a worker-seam + a "self-improving supervisor" wrapper around `supervise()`; passing a custom `makeWorkerAgent` that runs `runAgentic` |
| Run a profile through a topology shape over the keystone Supervisor, end-to-end | `runPersonified({ persona, shape, task, budget })`: `/loops` | a hand-rolled `createSupervisor().run` + seam-wiring helper |
| Loop a worker over one evolving artifact, K rounds, stop-when-good | `loopUntil(seed, spec)` as the `shape`: `/loops` | a `while(!done){runWorker();decide()}` hand-loop or "multi-attempt refine driver" |
| Run a worker agent under test conversing with a **simulated-user persona**, K rounds, worker-only metered | `runPersonaConversation({ worker, persona, backendFor, systemPromptOf })`: root `.` (also `/loops`) | a hand-rolled per-agent `dispatchWithSurface` bridge / eval-dispatch loop |
| Run **two `AgentProfile`s head-to-head** with a separate resumable session for each actor | `runConversation(...)` from root `.` | a hand-rolled two-agent turn loop |
| Drop a persona⟷agent conversation into an eval matrix as its dispatch | `runPersonaDispatch` → `runProfileMatrix({ dispatch })`: root `.` / `agent-eval/campaign` | a per-agent custom dispatch bridge |
| Best-of-N / parallel-research / map-reduce at equal compute | `fanout(items, opts)`: `/loops` | `Promise.all` over N calls + manual argmax/merge (bypasses the budget pool → breaks equal-k) |
| Produce-then-gate with a real checker | `verify(spec)`: `/loops` | "generate, then self-check with the same model, ship if ok" (collapses selector+judge) |
| Multi-judge review / rubric quorum over one artifact | `panel(spec)`: `/loops` | a judge ensemble that feeds one judge's score into another |
| Fixed sequential chain (plan→implement→…) | `pipeline(stages)`: `/loops` | hand-chained `await`s passing outputs along |
| Adaptive tree search / progressive widening | `widen(spec)` + `flatWidenGate()`: `/loops` | a best-first/MCTS that reads child *scores* to expand (selector=judge); keep `flatWidenGate()` until your gate is proven |
| Define the profile record for a personified run | `definePersona(input)`: `/loops` | a "profile-seam" / agent-config wrapper carrying model+prompt+tools+role |
| Make a worker self-verify / iterate / audit | a **hook / process / skill on its authored `AgentProfile`**: §1.5 | a per-round judge, a `while(!done)` loop, or a bash hill-climb (it's a profile lever) |
| Run an authored profile with Claude Code, Codex, OpenCode, or another supported harness | author the `AgentProfile` with `@tangle-network/agent-interface`; `@tangle-network/sandbox` materializes it for the selected harness | a harness-specific profile or config writer |
| Have the supervisor design its workers | author a **full `AgentProfile`** per sub-task (prompt+skills+tools+mcp+hooks+subagents): `/loops` | author a bare `systemPrompt` string (a worker can't act on levers it has no levers for) |
| Write a custom driver Agent and run it directly | `createSupervisor().run(root, task, opts)`: `/loops` | a bespoke orchestrator that spawns sub-agents and tallies cost (equal-compute claim breaks there) |
| Run depth-vs-breadth (or a custom strategy) over a stateful tool domain | `runAgentic({ surface, task, mode\|strategy, budget })`: `/loops` | a hand-rolled `Supervisor.run` + journal/registry, or a depth/breadth loop |
| Author a new topology/strategy compactly | `defineStrategy(name, body)` using `ctx.shot()`+`ctx.critique()`: `/loops` | a 70-line driver with `scope.spawn`/`scope.next` ceremony, or trusting a body-returned score |
| Compare strategies + get a significance report on a domain | `runBenchmark({ environment, tasks, worker, strategies })`: `/loops` | your own strategy-comparison loop / paired-bootstrap / Pareto math |
| Add a stateful tool-using domain | implement `AgenticSurface` (5 hooks: open/tools/call/score/close): `/loops` | a bespoke per-benchmark agent runner / tool-loop harness |
| Run a sandbox coding rollout, round-synchronous (fresh box per round) | `runAgentRounds(options)`: `/loops` | a `new Sandbox()`+acquire+stream+parse+delete loop, or a 2nd winner-selector |
| Run **agent-eval fixture folders** through runtime `runAgentRounds` | agent-eval fixture loading/planning, then `loopCampaignDispatch(...)`: `/loops` | a one-off `runCampaign` dispatch that hand-builds `ExecCtx`, drops loop traces, or forgets token/cost reporting |
| Run + **resume** ONE persistent box across turns | `openSandboxRun(client, opts, deliverable)`: `/loops` | a per-domain `new Sandbox`+`box.fs.read`+delete copy |
| Run **ONE agent turn** on any substrate: box (`streamPrompt`), cli-bridge/router `Executor`, or in-process chat backend: as ONE normalized `RuntimeStreamEvent` stream with a guaranteed terminal result+usage event; opt into in-stream `tool_call`/`tool_result` with `preserveToolParts`, or tap the raw sandbox events with `onRawEvent` | `streamAgentTurn(backend, prompt, { signal, timeoutMs, preserveToolParts?, onRawEvent? })` + `collectAgentTurn(stream)`: `/loops` | a per-provider stream→event mapper zoo, a hand-faked box around a non-box executor, or raw fetch leaking through the turn abstraction |
| Pick the **execution transport a driven loop runs on** (`sandbox` box / cli-bridge / router) from a product flag | `resolveSandboxClient({ backend })`: `/loops` | a per-product `if (backend === 'router') …` branch re-wiring `createExecutor` + `inlineSandboxClient` |
| Pick the **chat backend an in-process turn runs on** (`router`/`tcloud`/`cli-bridge`/`sandbox`) from a product flag | `resolveAgentBackend({ backend })`: root `.` | the copy-pasted `backend-name → createOpenAICompatibleBackend` branch every eval product hand-rolled (the copies drift) |
| Pick / register a leaf backend, or bring your own agent | `createExecutor({ backend })` / `createExecutorRegistry()` / implement `Executor`: `/loops` | a per-vendor adapter or closed `inline\|sandbox\|cli` switch (won't report through the `UsageEvent` channel) |
| Optimize text or named components with upstream GEPA | `officialGepa({ recipe, ... })`, passed as `improve(...).method` from root `.` | a local GEPA approximation, prompt mutation loop, or silent fallback when Python is unavailable |
| Optimize one text surface with Microsoft SkillOpt | `officialSkillOpt({ trainer, optimizer, ... })`, passed as `improve(...).method` from root `.` | Runtime-owned SkillOpt search or a silent local fallback |
| Improve one profile coordinate | `improve(profile, { surface, executionRef, method, trainScenarios, selectionScenarios, testScenarios, judges, agent, costCeiling })` from root `.`; `executionRef` binds saved work to executable behavior, `agent` receives the exact complete candidate profile, and the total-cost option limits the whole run | an implicit per-surface optimizer, a method that sees final-test cases, an unmeasured profile mutation, or separate optimizer and final-test spend limits |
| Inspect observed optimizer package, model, usage, cost, and resumed-run evidence before proposing a change | `createOptimizationActivationReceipt(result)` from `/intelligence` | reconstructing optimizer evidence from logs or trusting caller-authored metadata |
| Compare complete optimization methods directly | `compareOptimizationMethods(...)` from `agent-eval/campaign` | comparing one method's training score to another method's final score |
| Improve repository code | `improve({ surface: 'code', code, scenarios, judge, agent, budget })` from root `.` | passing code through a text optimizer or managing candidate worktrees in product code |
| Decide ship/hold on a candidate (campaign context) | `defaultProductionGate({ holdoutScenarios, deltaThreshold })`; compose with `heldOutGate` / `composeGate`: `agent-eval/contract` | a raw `h1>h0` point comparison on the training set |
| Decide ship/hold from a **`BenchmarkReport`** (per-task cells) | `promotionGate({ report, incumbent, candidate })`: `/loops` | comparing two strategies' mean scores directly; re-deriving the bootstrap |
| Run the full multi-generation strategy flywheel + certify | `runStrategyEvolution(config)`: `/loops` | a bespoke gen0→author→gen1→holdout loop with hand-rolled champion selection |
| Add or run a benchmark from the CLI/harness | `ADAPTERS` / `resolveAdapter(key)`, run via `bench/src/gate-cli.mts` | a per-script `switch(bench)` or a local benchmark-factory map |
| Wire a new benchmark | implement `BenchmarkAdapter` (5 methods) + feed to `runGate`: `bench` | a bespoke per-benchmark run script with its own (self-authored) scoring |
| Measure a topology on a benchmark at equal compute | `runGate(cfg)` (or `runAgentic`/`runBenchmark`): equal-k holds via the conserved budget pool: `bench`/`/loops` | a batch-blind/batch-oracle/compare zoo, your own usage capture, or equal-k bookkeeping |
| Observe a run's full cost/time | `createWaterfallCollector()` → `anytimeReport()`: `/loops` | a per-step cost/token tally by inspecting events yourself (drifts from billed totals) |
| Meter **one `openSandboxRun` cell's token/cost usage** (the metering seam for bench cells) | `sumSandboxUsage(events)`: `/loops` (folds `extractLlmCallEvent` over the run's events) | a per-bench usage tally re-parsing raw sandbox events (misses usage → integrity-guard rejects the cell) |
| Stand up a **product eval leaderboard** (declare `cases` + `prompt` + `score` → harness×model matrix + ranked board): START HERE (product leaderboards) | `defineLeaderboard(spec)`: `/loops` (every default overridable: `backends`/`dispatch`/`judges` seams; `runProfileMatrix` stays public as the escape floor; `toBenchmarkAdapter()` registers it into a benchmark registry) | the hand-rolled `expandProfileAxes` + `loopDispatch` + `runProfileMatrix` assembly (~650 lines/product) with its stale cell-cache, zero-token stub-cell, and missing-model-snapshot footguns |
| Render a **multi-profile × multi-axis benchmark leaderboard** (ranked board + score matrix + SVG/HTML charts) from an EXISTING fleet of matrix runs | `leaderboard(records)` + `renderLeaderboardMarkdown` / `renderLeaderboardSvg` / `renderLeaderboardHtml`: `/loops` (feed it `runProfileMatrix().records`, any domain; `defineLeaderboard` calls these for you) | a per-benchmark report/chart renderer; hand-rolled SVG/markdown tables; a curated subset of axes |
| Attach N observers to a running loop | `composeRuntimeHooks(...)`: root export | a second event-bus or callback-prop zoo (there is ONE stream) |
| Ship traces to an OTLP collector | `createOtelExporter()` + `buildLoopOtelSpans()`: root export | your own OTLP serializer or pulling the OTEL SDK |
| Know **what got mounted into a run** / **why a candidate won** | `result.provenance.mounts` / `result.provenance.selectionReceipts` (`MountManifestEntry`/`SelectionReceipt`/`RunProvenance`); declare mounts via the `recordMount` recorder in `prepareBox`: root export | re-reading box contents to reconstruct what was mounted, or re-deriving which candidate the selector picked |
| State any benchmark/A-B claim | `pairedLift(...)` (bench) over `pairedBootstrap`/`heldoutSignificance` (substrate) | your own bootstrap loop/PRNG per gate; a point lift without `low/high/pairs` |
| Let an agent **delegate ONE generic INTENT** (no fixed coder/researcher type) and get the result + real spend SYNCHRONOUSLY | the **`delegate` tool**: `createDelegateHandler` via `createMcpServer({ delegateSupervisor })`; mount it over the `agent-runtime mcp` bin with `MCP_ENABLE_DELEGATE=1` (the bin authors a supervisor over a `sandbox` backend): `/mcp` | a hardcoded coder/researcher profile, or task-specific `delegate_code`/`delegate_research` verbs (RETIRED): `delegate` is the ONE delegation path and the only one with a cost channel |
| Run a coding task INSIDE the agent's OWN sandbox session (a sibling box, fresh branch, validated patch) | `detachedSessionDelegate({ sandboxClient \| executor, workerProfile? })`: `/mcp` (pass the worker `AgentProfile`; omit for a minimal model-only default) | a hardcoded coder profile baked into the delegate; `delegate()` (that spawns workers in a *chosen* backend, not the agent's own session) |
| Have a **supervisor spawn + live-drive workers in a backend you choose** and observe or steer them while the coordinator is alive | the **coordination MCP** via `createCoordinationTools` / `serveCoordinationMcp` over a live `Scope`; each worker's leaf is `createExecutor({ backend })` | `detachedSessionDelegate`, which is own-sandbox-session only and one-shot. Supervised-tree restart recovery is not implemented. |
| Stand up a vertical agent in the eval loop | `defineAgent(manifest)` + `createSurfaceImprovementProposer`: `/agent` | a per-vertical manifest parser, surface-validator, or bespoke findings-to-patch mapper |
| Observe + deliver Intelligence on a live agent (send RunRecords + receive certified profile/diffs) | `withIntelligence(agent, { project, target })`: `/intelligence` (proposals surfaced, never auto-applied; `effort: 'off'` proves inference-only billing) | a custom trace-wrapper, a second receive path, or hand-rolled effort/tier config |
| Turn trace evidence into one measured, review-only agent proposal | `proposeAgentImprovement({ analysis, profile, improvement, buildExperiment, placeCell })` in `/intelligence` (Runtime seals the optimizer ancestry) | manually joining analysis, optimizer ancestry, exact candidate execution, uncertainty, and candidate identity |
| Freeze a measured profile/diff plus a content-addressed code surface into one executable candidate | `buildAgentCandidateBundle(...)`, then `verifyAgentCandidateBundle(...)` at execution: `/candidate-execution` | a product callback that converts profile fields, reproduces Git diff flags, hashes bytes, or assembles `AgentCandidateBundle` by hand |
| Record approve/reject/change-request feedback against one exact proposal | `reviewAgentImprovementProposal(proposal, review)`: `/intelligence` | a mutable status row that is not bound to candidate bytes |
| Run and grade the exact signed baseline-versus-candidate matrix before review | `runAgentCandidateExperiment({ experiment, placeCell })` in `/intelligence`; use `createProtectedExactProcessCandidateExperimentExecutor(...)` for any exact-process provider with protected model grants and pass the remaining product ports as `hostPorts` | product-local pairing, retry, isolation, receipt, and comparison code |
| Authorize and execute writes only for the exact measured and approved candidate | `createAgentImprovementActivation(...)`, then `executeAgentImprovementActivation(...)` with one idempotent transition in `/intelligence`; opaque profile changes use `prepareAgentImprovementProfileActivation({ stateDigest, resolveState? })`, target one complete profile identity, and restore only from product-retained state by exact digest; use `createKnowledgeImprovementActivationExecutor(...)` from `/knowledge` for one local KB | a mutable approval flag, a second per-surface approval path, a best-effort profile restore, or a write that does not persist an exact result |
| Capture and restore exact task, candidate, or memory workspace bytes | `captureAgentCandidateWorkspace(...)` + `createAgentCandidateWorkspacePort(...)`: `/candidate-execution` | a product-specific archive format, ambient `git checkout`, or a materializer that skips byte/path/mode verification |
| Fold **certified prompt additions into a system prompt you assemble yourself** (product chat routes) | `createCertifiedPromptSource({ target })` → `source.compose(base)`: `/intelligence` (cached, coalesced, fail-closed; `withIntelligence` rides the same source) | a module-scope cache + refresh-window + keep-last-known loop around `pullCertified` in product wiring |
| Produce a frozen KB candidate with runtime agents, readiness checks, and measured supervised spend | `runKnowledgeImprovementJob(options)` from `/knowledge`, then the shared activation path above after review | hand-wiring `improveKnowledgeBase` + a supervised updater, or letting candidate search write live knowledge |

For the full export inventory (every primitive, its import path, its summary: generated, never stale), see `docs/api/primitive-catalog.md`; for per-symbol signatures, the per-module `docs/api/` pages. For the recursive atom (recursion · isolated-or-collaborative artifact · conserved budget · analysts) and the two-timescale architecture, see `docs/architecture.md`. For the profile→run→optimize→ship spine in depth, `docs/concepts.md` + `docs/learning-flywheel.md`. For the Intelligence SDK (Observe + the provable-OFF billing boundary), `docs/intelligence-sdk.md`.

## 2.1 Which front door do I use?: the four public verbs

§2 maps a fine-grained intent to a primitive; this is the coarse router one level up. Pick a front door by **what you hand in**. Each bottoms out at ONE function; the §2 rows above carry each one's "do NOT build" twin. Exact per-symbol signatures + line anchors live in the generated `docs/api/` pages (never stale); the file paths below are what the freshness gate protects.

| You hand in… | Front door | Bottoms out at | What it is |
|---|---|---|---|
| a **string intent** ("fix the failing auth test"): you don't care HOW | the `delegate` tool | `delegate(intent, opts)`: `src/runtime/supervise/delegate.ts` (MCP handler `createDelegateHandler`, `src/mcp/tools/delegate.ts`) | a default authoring supervisor decomposes the intent and writes the worker profile per sub-task; synchronous, returns the delivered output + `spentTotal`. The ONE delegation path. |
| an **authored supervisor `AgentProfile`** + a task | `supervise(profile, task, opts)` | `src/runtime/supervise/supervise.ts` | the one-call LLM-brain driver over the keystone `Supervisor`, scaffolding defaulted. START HERE when you wrote the driver. |
| a **deterministic shot grammar** over a stateful tool domain | `runAgentic(opts)` | `src/runtime/strategy.ts` | runs a `Strategy` (depth/breadth/custom) through the `Supervisor`: programmatic, no LLM picking the shape. |
| a **deterministic topology combinator** (`loopUntil`/`fanout`/`verify`/`panel`/`pipeline`) over a persona | `runPersonified(options)` | `src/runtime/personify/persona.ts` | composes a persona + a `CombinatorShape` over the `Supervisor`: programmatic. |

Rule of thumb: `delegate` = "I don't care how"; `supervise` = "I authored the driver"; `runAgentic`/`runPersonified` = "I want a deterministic topology, no LLM choosing the shape." All four run over the one `Executor` port on the conserved budget pool, so equal-compute holds by construction.

**Two-agent patterns: compose a shape, don't hand-roll a turn loop:**

| Pattern | Use | Bottoms out at |
|---|---|---|
| **researcher → engineer** (gather, then build) | `defineStrategy(name, body)`: both agents in one body via `ctx.shot()` + `ctx.critique()` | `src/runtime/strategy.ts:789` |
| **implement → verify** (build, then a SEPARATE checker gates it: selector ≠ judge) | `verify(spec)` as the `shape` | `src/runtime/personify/combinators.ts:333` |
| **N-judge panel** (fan judges out, merge verdicts) | `panel(spec)` as the `shape` | `src/runtime/personify/combinators.ts:273` |
