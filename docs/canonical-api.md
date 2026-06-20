# `@tangle-network/agent-runtime` — Canonical API Reference

<!-- This doc is the JUDGMENT layer: the mental model (§1), the AgentProfile law (§1.5), and the anti-reinvention decision table (§2). Per-symbol signatures + `file:line` are GENERATED into `docs/api/` (TypeDoc, do NOT hand-edit) — that is the mechanical reference. The freshness gate (`pnpm docs:freshness`) FAILS CI if a version pin, a cited `file:line`, or a decision-table symbol drifts from source — see `docs/MAINTAINING.md`. Keep this file the small, hand-curated spine. -->

> **Version 0.69.0.** Per-symbol signatures live in the generated `docs/api/` reference (one page per module). The pinned substrate is agent-eval `>=0.93.0 <1.0.0`; the sandbox substrate that materializes profiles into harness shapes is `@tangle-network/sandbox` (peer `>=0.8.0 <1.0.0`). The neutral contract types (`AgentProfile`, `AgentProfileMcpServer`, `HarnessType`, `ReasoningEffort`, `Part`/`ToolPart`/`ToolState`) are owned by **`@tangle-network/agent-interface`** (peer `>=0.10.0 <1.0.0`) — the single source of truth. Substrate symbols (`selfImprove`/`gepaDriver`/`defaultProductionGate`/`heldOutGate`/`pairedBootstrap`/…) are re-exported through `@tangle-network/agent-eval/contract` (or `/campaign`), not local to this package.
>
> **`./loops` is the runtime barrel** — `package.json` maps it to `src/runtime/index.ts`. Everything below labelled `/loops` is the recursive-atom + loop-kernel surface.
>
> **Read this before writing any orchestration, optimization, or measurement code in this repo.** If you are about to write a persona⟷agent conversation runner, a "skill optimizer", a "profile-seam", a depth-vs-breadth A/B harness, a bootstrap loop, or a `new Sandbox(...)` + stream + read dance — **stop**, it already exists, and a parallel will silently break a load-bearing invariant (equal-k, selector≠judge, capture-integrity, or eval/prod parity).

## 1. Mental model — the spine

A **genome** (an `AgentProfile`: `systemPrompt + skills + tools + mcp + knowledge + memory + rag` — one combined surface) is run as a **driver⟷worker conversation** (`runPersonified` composing a combinator like `loopUntil`/`fanout` over the keystone `Supervisor` — K rounds spent against one persistent, journaled, resumable artifact on a *conserved budget pool* so equal-compute holds by construction) over a **benchmark** (the `ADAPTERS` registry driven by `runGate` over the Supervisor, or an `AgenticSurface` driven by `runBenchmark`/`runAgentic`), then **optimized by a gated loop** (`selfImprove`/`runImprovementLoop` + `gepaDriver`, certified by `defaultProductionGate`/`heldOutGate`/`promotionGate`, or the full multi-generation `runStrategyEvolution`) that evolves the genome and **certifies wins on a frozen holdout** — never on the training composite. The selector is never the judge; observation attaches to the *loop* via `RuntimeHooks`, never to the portable genome.

Two substrates implement the same recursive-atom over the one `Executor` port and share `defaultSelectWinner` — a deliberate pair, **do not invent a third**: the **reactive** `Supervisor`/`Scope` + personify combinators (the agent-driver; equal-k by construction via the conserved budget pool — prefer for NEW recursive/keystone work) and the round-synchronous **`runLoop`** kernel (the leaf; what most sandbox benches drive today). `inlineSandboxClient` adapts any non-box `Executor` into a `SandboxClient` for `runLoop`, and `settledToIteration` bridges reactive `Settled`s into the kernel's `Iteration`, so the two interoperate without forking selection or metering.

## 1.5 The AgentProfile law — author the profile, the substrate materializes it (WE KEEP FORGETTING THIS)

**An agent IS its `AgentProfile`, and the profile is the WHOLE agent — not just a prompt.** The surface is `systemPrompt + skills + tools + mcp + subagents + hooks + permissions + memory/rag + model` (the `AgentProfile*` family in `@tangle-network/sandbox`, constructed via `defineAgentProfile`). **System prompt ≠ skills** — skills are separate, invokable how-tos the agent reads *when prompted to invoke them*; never concatenate a skill body into the system prompt.

**You change an agent's behavior by changing its PROFILE — never by writing orchestration code around it.** The behaviors we keep hand-rolling are profile properties:
- **Self-verification** is a profile lever, three ways, all configuration and zero glue code: (1) *steered* — the prompt says "run the tests, read failures, fix, repeat"; (2) *process-defined* — its instructions make verify-after-every-change its standing process; or (3) a **post-finish hook** that auto-runs the check and feeds failures back. The harness runs that loop. **You do not write a per-round judge, a `while(!done)`, or a bash hill-climb.**
- **Iteration, delegation, audit-against-spec** are likewise hooks / subagents / skills / process *in the profile*.

**The sandbox substrate materializes a profile into the harness's real shapes — so author the GENERAL profile and NEVER code to a harness.** `@tangle-network/sandbox` renders an `AgentProfile` into whatever the running harness needs (instructions file, tool/MCP config, mounted skills, hooks, subagents). opencode / Claude Code / Codex are interchangeable *targets*; opencode is only the local **test** substrate behind the cli-bridge. **Do NOT write harness-specific config or a `profile → opencode.json` realizer.** A lever that isn't materialized yet is a **substrate gap to fill in `@tangle-network/sandbox`**, not a bespoke realizer here.

**Therefore the supervisor's only intelligence is AUTHORING full profiles** — the optimizable self-improvement surface: read the task, decompose it, and for each sub-task author the *complete* profile (which prompt, skills, tools/MCP, hooks, subagents, model). The quality of a worker IS the quality of the profile authored for it. **The harness executes; you compose.**

## 2. Decision table — "I want to ___ → use ___ → NOT ___"

Every symbol below is a LOCAL export of this package (subpath shown) unless tagged with a substrate package (`agent-eval/contract`, `@tangle-network/sandbox`) or `bench`. Per-symbol signatures: the generated `docs/api/` reference.

| I want to… | Use (import) | Do NOT build |
|---|---|---|
| **Just run a supervisor to a goal (one call, scaffolding defaulted)** — START HERE | `supervise(profile, task, { budget, backend? })` — `/loops` | hand-wiring `createSupervisor().run` + `blobs`/`perWorker`/`journal`/`executors`; reaching for the lower-level run-verbs below before you need a specific counterparty |
| Run a genome through a topology shape over the keystone Supervisor, end-to-end | `runPersonified({ persona, shape, task, budget })` — `/loops` | a hand-rolled `createSupervisor().run` + seam-wiring helper |
| Loop a worker over one evolving artifact, K rounds, stop-when-good | `loopUntil(seed, spec)` as the `shape` — `/loops` | a `while(!done){runWorker();decide()}` hand-loop or "multi-attempt refine driver" |
| Run a worker agent under test conversing with a **simulated-user persona**, K rounds, worker-only metered | `runPersonaConversation({ worker, persona, backendFor, systemPromptOf })` — root `.` (also `/loops`) | a hand-rolled per-agent `dispatchWithSurface` bridge / eval-dispatch loop |
| Run **two `AgentProfile`s head-to-head** over a persistent transcript | `runConversation(...)` — root `.` | a hand-rolled two-agent turn loop |
| Drop a persona⟷agent conversation into an eval matrix as its dispatch | `runPersonaDispatch` → `runProfileMatrix({ dispatch })` — root `.` / `agent-eval/campaign` | a per-agent custom dispatch bridge |
| Best-of-N / parallel-research / map-reduce at equal compute | `fanout(items, opts)` — `/loops` | `Promise.all` over N calls + manual argmax/merge (bypasses the budget pool → breaks equal-k) |
| Produce-then-gate with a real checker | `verify(spec)` — `/loops` | "generate, then self-check with the same model, ship if ok" (collapses selector+judge) |
| Multi-judge review / rubric quorum over one artifact | `panel(spec)` — `/loops` | a judge ensemble that feeds one judge's score into another |
| Fixed sequential chain (plan→implement→…) | `pipeline(stages)` — `/loops` | hand-chained `await`s passing outputs along |
| Adaptive tree search / progressive widening | `widen(spec)` + `flatWidenGate()` — `/loops` | a best-first/MCTS that reads child *scores* to expand (selector=judge); keep `flatWidenGate()` until your gate is proven |
| Define the genome record for a personified run | `definePersona(input)` — `/loops` | a "profile-seam" / agent-config wrapper carrying model+prompt+tools+role |
| Make a worker self-verify / iterate / audit | a **hook / process / skill on its authored `AgentProfile`** — §1.5 | a per-round judge, a `while(!done)` loop, or a bash hill-climb (it's a profile lever) |
| Run an authored profile on a real harness | author the `AgentProfile`, hand it to the **sandbox substrate** — `@tangle-network/sandbox` (`defineAgentProfile`) | a `profile → opencode.json` realizer or any harness-specific config writer |
| Have the supervisor design its workers | author a **full `AgentProfile`** per sub-task (prompt+skills+tools+mcp+hooks+subagents) — `/loops` | author a bare `systemPrompt` string (a worker can't act on levers it has no levers for) |
| Write a custom driver Agent and run it directly | `createSupervisor().run(root, task, opts)` — `/loops` | a bespoke orchestrator that spawns sub-agents and tallies cost (equal-compute claim breaks there) |
| Run depth-vs-breadth (or a custom strategy) over a stateful tool domain | `runAgentic({ surface, task, mode\|strategy, budget })` — `/loops` | a hand-rolled `Supervisor.run` + journal/registry, or a depth/breadth loop |
| Author a new topology/strategy compactly | `defineStrategy(name, body)` using `ctx.shot()`+`ctx.critique()` — `/loops` | a 70-line driver with `scope.spawn`/`scope.next` ceremony, or trusting a body-returned score |
| Compare strategies + get a significance report on a domain | `runBenchmark({ environment, tasks, worker, strategies })` — `/loops` | your own strategy-comparison loop / paired-bootstrap / Pareto math |
| Add a stateful tool-using domain | implement `AgenticSurface` (5 hooks: open/tools/call/score/close) — `/loops` | a bespoke per-benchmark agent runner / tool-loop harness |
| Run a sandbox coding rollout, round-synchronous (fresh box per round) | `runLoop(options)` — `/loops` | a `new Sandbox()`+acquire+stream+parse+delete loop, or a 2nd winner-selector |
| Run + **resume** ONE persistent box across turns | `openSandboxRun(client, opts, deliverable)` — `/loops` | a per-domain `new Sandbox`+`box.fs.read`+delete copy |
| Pick / register a leaf backend, or bring your own agent | `createExecutor({ backend })` / `createExecutorRegistry()` / implement `Executor` — `/loops` | a per-vendor adapter or closed `inline\|sandbox\|cli` switch (won't report through the `UsageEvent` channel) |
| Evolve a **prompt/string** surface | `gepaDriver({ llm, model, target })` (default inside `selfImprove`) — `agent-eval/contract` | a hand-rolled prompt-mutation reflection loop with its own Pareto bookkeeping |
| Self-improve a profile (one pluggable verb) — START HERE | `improve(profile, findings, { surface, gate })` — root `.` (the RSI verb; defaults the generator from `surface`, wraps `selfImprove`) | a bespoke optimize loop, or calling `selfImprove`/a skill-optimizer directly for the common case |
| Run the self-improvement loop with full substrate control | `selfImprove({ agent, scenarios, judge, baselineSurface })` — `agent-eval/contract` | a bespoke optimize loop or a parallel skill-optimizer |
| Run the gated loop with full control | `runImprovementLoop({ baselineSurface, dispatchWithSurface, driver, holdoutScenarios, gate })` — `agent-eval/contract` | your own propose→campaign→rank→re-score-on-holdout→gate→PR loop |
| Decide ship/hold on a candidate (campaign context) | `defaultProductionGate({ holdoutScenarios, deltaThreshold })`; compose with `heldOutGate` / `composeGate` — `agent-eval/contract` | a raw `h1>h0` point comparison on the training set |
| Decide ship/hold from a **`BenchmarkReport`** (per-task cells) | `promotionGate({ report, incumbent, candidate })` — `/loops` | comparing two strategies' mean scores directly; re-deriving the bootstrap |
| Run the full multi-generation strategy flywheel + certify | `runStrategyEvolution(config)` — `/loops` | a bespoke gen0→author→gen1→holdout loop with hand-rolled champion selection |
| Add or run a benchmark from the CLI/harness | `ADAPTERS` / `resolveAdapter(key)`, run via `bench/src/gate-cli.mts` | a per-script `switch(bench)` or a local benchmark-factory map |
| Wire a new benchmark | implement `BenchmarkAdapter` (5 methods) + feed to `runGate` — `bench` | a bespoke per-benchmark run script with its own (self-authored) scoring |
| Measure a topology on a benchmark at equal compute | `runGate(cfg)` (or `runAgentic`/`runBenchmark`) — equal-k holds via the conserved budget pool — `bench`/`/loops` | a batch-blind/batch-oracle/compare zoo, your own usage capture, or equal-k bookkeeping |
| Observe a run's full cost/time | `createWaterfallCollector()` → `anytimeReport()` — `/loops` | a per-step cost/token tally by inspecting events yourself (drifts from billed totals) |
| Attach N observers to a running loop | `composeRuntimeHooks(...)` — root export | a second event-bus or callback-prop zoo (there is ONE stream) |
| Ship traces to an OTLP collector | `createOtelExporter()` + `buildLoopOtelSpans()` — root export | your own OTLP serializer or pulling the OTEL SDK |
| State any benchmark/A-B claim | `pairedLift(...)` (bench) over `pairedBootstrap`/`heldoutSignificance` (substrate) | your own bootstrap loop/PRNG per gate; a point lift without `low/high/pairs` |
| Compose the prod sandbox profile (eval/prod parity) | `composeProductionAgentProfile(base, opts)` — `/mcp` | hand-merging a delegation/retrieval MCP per call site or maintaining two profiles |
| Let an agent **delegate a coding task inside its OWN sandbox environment** (durable, fire-and-poll, survives restart) | the **delegation MCP** — `delegate_code`/`delegate_research` + `delegation_status`/`delegation_history`/`delegate_feedback`, wired by `composeProductionAgentProfile` — `/mcp` | `spawn_agent` — a worker in a *separate, chosen* backend; not own-environment delegation, no durable queue/ledger |
| Have a **supervisor spawn + live-drive workers in a backend you choose** and observe/steer/resume them | the **coordination MCP** — `createCoordinationTools` / `serveCoordinationMcp` over a live `Scope`; each worker's leaf is `createExecutor({ backend })` — `/mcp`,`/loops` | `delegate_code` — own-sandbox-only, one-shot, no live steer/recursion/conserved-budget |
| Stand up a vertical agent in the eval loop | `defineAgent(manifest)` + `createSurfaceImprovementAdapter` — `/agent` | a per-vertical manifest parser, surface-validator, or bespoke `ImprovementAdapter` |
| Turn intelligence/observation OFF (prove inference-only billing) | `withTangleIntelligence(agent, { effort: 'off' })` — `/intelligence` | a custom trace-wrapper or hand-rolled effort/tier config |

For the recursive atom (recursion · isolated-or-collaborative artifact · conserved budget · analysts) and the two-timescale architecture, see `docs/architecture.md`. For the genome→run→optimize→ship spine in depth, `docs/concepts.md` + `docs/learning-flywheel.md`. For the Intelligence SDK (Observe + the provable-OFF billing boundary), `docs/intelligence-sdk.md`.
