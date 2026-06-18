# `@tangle-network/agent-runtime` — Canonical API Reference

> **Version 0.66.0.** Every signature below was read from source and is cited `file:line`. `@experimental` is flagged per-entry. When a citation is to `node_modules/@tangle-network/agent-eval/...`, the symbol lives in the **substrate** and is consumed here — import it from `@tangle-network/agent-eval/contract` (or `/campaign`), not from this package. (The pinned substrate is agent-eval `>=0.93.0 <1.0.0`.) The neutral contract types (`AgentProfile`, `AgentProfileMcpServer`, `HarnessType`, `ReasoningEffort`, `Part`/`ToolPart`/`ToolState`) are owned by **`@tangle-network/agent-interface`** (peer `>=0.5.0 <1.0.0`, currently ~0.10.0) — the single source of truth, which also ships the capability layer (`harnessSupportsModel` / `reasoningEffortsFor` / `reasoningLadder`). The `/runtime` barrel re-exports `AgentProfile` for back-compat.
>
> **`./loops` and `./runtime` are the SAME barrel** — `package.json` maps both subpaths to `src/runtime/index.ts` (`./loops` is the back-compat alias). Anything below shown as `/loops` is equally importable from `/runtime`, and vice-versa.
>
> **Read this before writing any orchestration, optimization, or measurement code in this repo.** The canonical path is below. If you are about to write a persona⟷agent conversation runner, a "skill optimizer", a "profile-seam", a depth-vs-breadth A/B harness, a bootstrap loop, or a `new Sandbox(...)` + stream + read dance — **stop**, it already exists (persona⟷agent dialogue → `runConversation`/`runPersonaConversation`, §3.1; the recursive driver⟷worker run → `runPersonified`+`loopUntil`, §3.1), and a parallel will silently break a load-bearing invariant (equal-k, selector≠judge, capture-integrity, or eval/prod parity).
>
> **Two things are called "conversation" — keep the layers straight.** `runConversation`/`runPersonaConversation` (`src/conversation/`, §3.1) = an **eval/dispatch** primitive: a worker `AgentProfile` under test conversing with a **persona driver** (a simulated user — an LLM role-playing the user, or a scripted turn list), worker-only metered, dropping into `runProfileMatrix`. `runPersonified`+`loopUntil` (`src/runtime/personify/`, §3.1) = the **recursive-atom execution** primitive: a persona running a topology shape over the keystone `Supervisor` (conserved budget, journaled artifact). They are different layers — do not collapse them.

## 1. Mental model — the spine

A **genome** (an `AgentProfile` / `AgentSurfaces`: `systemPrompt + skills + tools + mcp + knowledge + memory + rag` — one combined surface, not separate knobs) is run as a **driver⟷worker conversation** (`runPersonified` composing a combinator like `loopUntil`/`fanout` over the keystone `Supervisor` — K rounds spent against one persistent, journaled, resumable artifact on a *conserved budget pool* so equal-compute holds by construction) over a **benchmark** (the `ADAPTERS` registry, driven by `runGate`/`gate-cli.mts` over the keystone Supervisor, or an `AgenticSurface` driven by `runBenchmark`/`runAgentic` on the reactive substrate), then **optimized by a gated loop** (`selfImprove`/`runImprovementLoop` + `improvementDriver`/`gepaDriver` + `reflectiveGenerator`/`agenticGenerator`, certified by `defaultProductionGate`/`heldOutGate`/`promotionGate`, or the full multi-generation `runStrategyEvolution`) that evolves the genome and **certifies wins on a frozen holdout** — never on the training composite. The selector is never the judge; observation attaches to the *loop* via `RuntimeHooks`, never to the portable genome.

## 1.5 The AgentProfile law — author the profile, the substrate materializes it (WE KEEP FORGETTING THIS)

**An agent IS its `AgentProfile`, and the profile is the WHOLE agent — not just a prompt.** The surface is `systemPrompt + skills + tools + mcp + subagents + hooks + permissions + memory/rag + model` (the `AgentProfile*` family in `@tangle-network/sandbox`: `AgentProfilePrompt`, `AgentProfileMcpServer`, `AgentSubagentProfile`, `AgentProfileFileMount`, `AgentProfilePermission`, `AgentProfileModelHints`, …; constructed via `defineAgentProfile`). **System prompt ≠ skills** — skills are separate, invokable how-tos the agent reads *when prompted to invoke them*; never concatenate a skill body into the system prompt (we faked skills exactly that way once — it does not count as a skill).

**You change an agent's behavior by changing its PROFILE — never by writing orchestration code around it.** The behaviors we keep hand-rolling are profile properties:
- **Self-verification** is a profile lever, three ways, all configuration and zero glue code: (1) *steered* — the prompt says "run the tests, read failures, fix, repeat"; (2) *process-defined* — its instructions make verify-after-every-change its standing process; or (3) a **post-finish hook** that auto-runs the check and feeds failures back. The harness runs that loop. **You do not write a per-round judge, a `while(!done)`, or a bash hill-climb.**
- **Iteration, delegation, audit-against-spec** are likewise hooks / subagents / skills / process *in the profile*.

**The sandbox substrate materializes a profile into the harness's real shapes — so author the GENERAL profile and NEVER code to a harness.** `@tangle-network/sandbox` takes an `AgentProfile` and renders it into whatever the running harness needs (its instructions file, its tool/MCP config, its mounted skills, its hooks, its subagents). opencode / Claude Code / Codex are interchangeable *targets*; opencode is only the local **test** substrate behind the cli-bridge. **Do NOT write harness-specific config, a `profile → opencode.json` realizer, or anything that names a harness.** Author the profile, hand it to the substrate, let it materialize. A lever that isn't materialized yet is a **substrate gap to fill in `@tangle-network/sandbox`**, not a bespoke realizer here (this repo depends on the substrate; it never reimplements it).

**Therefore the supervisor's only intelligence is AUTHORING full profiles** — the optimizable self-improvement surface (`src/runtime/supervise/authoring.ts`): read the task, decompose it, and for each sub-task author the *complete* profile (which prompt, which skills, which tools/MCP, which hooks, which subagents, which model). The quality of a worker IS the quality of the profile authored for it. **The harness executes; you compose.** When you catch yourself about to write a loop, a judge, or harness config, stop — it's a lever on the profile.

## 2. Decision table — "I want to ___ → use ___ → NOT ___"

| I want to… | Use (import) | Do NOT build |
|---|---|---|
| Run a genome through a topology shape over the keystone Supervisor, end-to-end | `runPersonified({ persona, shape, task, budget })` — `/runtime` (also `/loops`) | a hand-rolled `createSupervisor().run` + seam-wiring helper (it's the ONE place persona seams reach the built-in executors) |
| Loop a worker over one evolving artifact, K rounds, stop-when-good | `loopUntil(seed, spec)` as the `shape` — `/runtime` | a `while(!done){runWorker();decide()}` hand-loop or "multi-attempt refine driver" |
| Run a worker agent under test conversing with a **simulated-user persona**, K rounds, worker-only metered | `runPersonaConversation({ worker, persona, backendFor, systemPromptOf })` — root `.` (also `/loops`) | a hand-rolled per-agent `dispatchWithSurface` bridge / eval-dispatch loop |
| Run **two `AgentProfile`s head-to-head** over a persistent transcript | `runConversation(...)` — `src/conversation/` (root `.`) | a hand-rolled two-agent turn loop |
| Drop a persona⟷agent conversation into an eval matrix as its dispatch | `runPersonaDispatch` → `runProfileMatrix({ dispatch })` — root `.` / `agent-eval/campaign` | a per-agent custom dispatch bridge (the thing `runPersonaConversation` was built to kill) |
| Best-of-N / parallel-research / map-reduce at equal compute | `fanout(items, opts)` — `/runtime` | `Promise.all` over N calls + manual argmax/merge (bypasses the budget pool → breaks equal-k) |
| Produce-then-gate with a real checker | `verify(spec)` — `/runtime` | "generate, then self-check with the same model, ship if ok" (collapses selector+judge) |
| Multi-judge review / rubric quorum over one artifact | `panel(spec)` — `/runtime` | a judge ensemble that feeds one judge's score into another / re-ranks behind a driver |
| Fixed sequential chain (plan→implement→…) | `pipeline(stages)` — `/runtime` | hand-chained `await`s passing outputs along |
| Adaptive tree search / progressive widening | `widen(spec)` + `flatWidenGate()` — `/runtime` | a best-first/MCTS that reads child *scores* to expand (selector=judge); keep it `flatWidenGate()` until your gate is proven |
| Define the genome record for a personified run | `definePersona(input)` — `/runtime` | a "profile-seam" / agent-config wrapper carrying model+prompt+tools+role |
| Make a worker self-verify / iterate / audit | a **hook / process / skill on its authored `AgentProfile`** (post-finish verify hook, a verify-after-edit process in its prompt, a verify skill) — §1.5 | a per-round judge, a `while(!done)` loop, or a bash hill-climb (the harness runs the loop — it's a profile lever) |
| Run an authored profile on a real harness | author the `AgentProfile`, hand it to the **sandbox substrate** to materialize — `@tangle-network/sandbox` (`defineAgentProfile`) | a `profile → opencode.json` realizer or any harness-specific config writer (opencode is only the cli-bridge *test* target; generalize, never specialize) |
| Have the supervisor design its workers | author a **full `AgentProfile`** per sub-task — `supervise/authoring.ts` (prompt+skills+tools+mcp+hooks+subagents) | author a bare `systemPrompt` string (the thin slice — a worker can't act on instructions it has no levers for) |
| Write a custom driver Agent and run it directly | `createSupervisor().run(root, task, opts)` — `/runtime` | a bespoke orchestrator that spawns sub-agents and tallies cost (equal-compute claim breaks there) |
| Run depth-vs-breadth (or a custom strategy) over a stateful tool domain | `runAgentic({ surface, task, mode\|strategy, budget })` — `/loops` | a hand-rolled `Supervisor.run` + journal/registry, or a depth/breadth loop |
| Author a new topology/strategy compactly | `defineStrategy(name, body)` using `ctx.shot()`+`ctx.critique()` — `/loops` | a 70-line driver with `scope.spawn`/`scope.next` ceremony, or trusting a body-returned score (it's harness-re-verified) |
| Compare strategies + get a significance report on a domain | `runBenchmark({ environment, tasks, worker, strategies })` — `/loops` | your own strategy-comparison loop / paired-bootstrap / Pareto math |
| Add a stateful tool-using domain | implement `AgenticSurface` (5 hooks: open/tools/call/score/close) — `/loops` | a bespoke per-benchmark agent runner / tool-loop harness |
| Run a sandbox coding rollout, round-synchronous (fresh box per round) | `runLoop(options)` — `/runtime` | a `new Sandbox()`+acquire+stream+parse+delete loop, or a 2nd winner-selector |
| Run + **resume** ONE persistent box across turns | `openSandboxRun(client, opts, deliverable)` — `/runtime` | a per-domain `new Sandbox`+`box.fs.read`+delete copy |
| Pick / register a leaf backend, or bring your own agent | `createExecutor({ backend })` / `createExecutorRegistry()` / implement `Executor` — `/runtime` | a per-vendor adapter or closed `inline\|sandbox\|cli` switch (won't report through the `UsageEvent` channel) |
| Evolve a **code** surface in a gated loop | `improvementDriver({ worktree, generator })` — `/improvement` | a "skill optimizer" / "topology mutator" that opens its own branches & applies patches |
| Evolve a **prompt/string** surface | `gepaDriver({ llm, model, target })` (default inside `selfImprove`) — `agent-eval/contract` | a hand-rolled prompt-mutation reflection loop with its own Pareto bookkeeping |
| Run a closed self-improvement loop (one call) | `selfImprove({ agent, scenarios, judge, baselineSurface })` — `agent-eval/contract` | a bespoke optimize loop or a parallel skill-optimizer |
| Run the gated loop with full control (custom code-surface driver / gate) | `runImprovementLoop({ baselineSurface, dispatchWithSurface, driver, holdoutScenarios, gate })` — `agent-eval/contract` | your own propose→campaign→rank→re-score-on-holdout→gate→PR loop |
| Decide ship/hold on a candidate (campaign context) | `defaultProductionGate({ holdoutScenarios, deltaThreshold })`; compose with `heldOutGate` / `composeGate` — `agent-eval/contract` | a raw `h1>h0` point comparison on the training set (certifies false champions near coin-flip) |
| Decide ship/hold from a **`BenchmarkReport`** (per-task cells) | `promotionGate({ report, incumbent, candidate })` — `/runtime` | comparing two strategies' mean scores directly; re-deriving the bootstrap |
| Run the full multi-generation strategy flywheel + certify | `runStrategyEvolution(config)` — `/runtime` | a bespoke gen0→author→gen1→holdout loop with hand-rolled champion selection + overfit check |
| Add or run a benchmark from the CLI/harness | `ADAPTERS` / `resolveAdapter(key)`, run via `bench/src/gate-cli.mts` | a per-script `switch(bench)` or a local benchmark-factory map |
| Wire a new benchmark | implement `BenchmarkAdapter` (5 methods) + feed to `runGate` — `bench` | a bespoke per-benchmark run script with its own (self-authored) scoring |
| Measure a topology on a benchmark at equal compute | `runGate(cfg)` (or `runAgentic`/`runBenchmark`) — equal-k holds by construction via the conserved budget pool — `bench`/`/runtime` | a batch-blind/batch-oracle/compare zoo, your own usage capture, or equal-k bookkeeping |
| Observe a run's full cost/time | `createWaterfallCollector()` → `anytimeReport()` — `/runtime` | a per-step cost/token tally by inspecting events yourself (drifts from billed totals) |
| Attach N observers to a running loop | `composeRuntimeHooks(...)` — root export | a second event-bus or callback-prop zoo (there is ONE stream) |
| See the live recursive agent tree | `createTopologyView()` / `renderTopologyTree()` — `/topology` | a parent-id `Map` you track yourself or a manual `SpawnJournal` walk |
| Ship traces to an OTLP collector | `createOtelExporter()` + `buildLoopOtelSpans()` — root export | your own OTLP serializer or pulling the OTEL SDK |
| State any benchmark/A-B claim | `pairedLift(...)` (bench) over `pairedBootstrap`/`heldoutSignificance` (substrate) | your own bootstrap loop/PRNG per gate; a point lift without `low/high/pairs` |
| Compose the prod sandbox profile (eval/prod parity) | `composeProductionAgentProfile(base, opts)` — `/mcp` | hand-merging a delegation/retrieval MCP per call site or maintaining two profiles |
| Let an agent **delegate a coding task inside its OWN sandbox environment** (durable, fire-and-poll, survives restart, idempotent by input) | the **delegation MCP** — `delegate_code`/`delegate_research` + `delegation_status`/`delegation_history`/`delegate_feedback`; default `detachedSessionDelegate` runs the in-box harness over the agent's *own* `SandboxClient` (sibling box, fresh branch on the agent's repo). Wired by `composeProductionAgentProfile` — `/mcp` | `spawn_worker` — that spawns a worker in a *separate, chosen* backend; it is NOT own-environment delegation and has no durable queue/ledger |
| Have a **supervisor spawn + live-drive workers in a backend you choose** (sandbox OR cli-bridge), and observe/steer/resume them in real time | the **coordination MCP** — `createCoordinationTools` / `serveCoordinationMcp` over a live `Scope`; each worker's leaf is `createExecutor({ backend })` (the one knob: `sandbox`\|`bridge`\|…) — `/mcp`,`/runtime` | `delegate_code` — that's own-sandbox-only (no backend choice), one-shot, no live steer/recursion/conserved-budget |
| Stand up a vertical agent in the eval loop | `defineAgent(manifest)` + `createSurfaceImprovementAdapter` — `/agent` | a per-vertical manifest parser, surface-validator, or bespoke `ImprovementAdapter` |
| Turn intelligence/observation OFF (prove inference-only billing) | `withTangleIntelligence(agent, { effort: 'off' })` — `/intelligence` *(branch, see §6)* | a custom trace-wrapper or hand-rolled effort/tier config |

## 3. Per-subsystem API

### 3.1 The Execution Spine — the driver⟷worker run

Two substrates coexist for the same "recursive agent decision" atom (see §5): the reactive **`Supervisor`/`Scope` + personify combinators** (canonical core — the agent-driver path; prefer for new recursive work) and the round-synchronous **`runLoop`** kernel (the leaf, what most sandbox benches drive today). Both run over the one open `Executor` port and share one selector (`defaultSelectWinner`). The "drive an agent" topology is authored either by an `AgentProfile` calling the coordination toolbox (`createCoordinationTools`, `/mcp`) over a live `Scope`, or by the packaged `runAgentic`/`defineStrategy` depth/breadth shapes.

---

**`runPersonified`** · `@tangle-network/agent-runtime/runtime` (also `/loops`) · `@experimental`
The end-to-end entrypoint of the reactive substrate. Composes a `Persona` (genome) + a chosen `LoopShape` onto a fresh keystone `Supervisor` and runs it to a typed `SupervisedResult<Outcome<D>>`. Adds no engine: it is `createSupervisor().run(shape(ctx), task, opts)`. It owns the ONE wiring invariant — the supervisor threads an **empty** seam bag to the root scope, so `runPersonified` is the one place a persona's raw `seams` get wrapped into a registry whose factories receive the merged seams (without it the built-in router/sandbox/cli executors can't read their config). It single-sources budget defaulting (per-child = root / fanout, default fanout 3).

```ts
function runPersonified<Task, D>(options: RunPersonifiedOptions<Task, D>): Promise<SupervisedResult<Outcome<D>>>
// RunPersonifiedOptions = { persona: Persona<D>; shape: LoopShape<Task,D> | string; task: Task;
//   budget: Budget; shapeBudget?: Partial<ShapeBudget>; runId?; journal?; blobs?; maxDepth?;
//   maxRestarts?; withinMs?; handle?; now?; signal? }
```
```ts
const result = await runPersonified({ persona, shape: loopUntil(seed, spec), task,
  budget: { maxIterations: 12, maxTokens: 200_000 } })
if (result.kind === 'winner' && result.out.kind === 'done') use(result.out.deliverable)
```
**Do NOT** hand-roll the persona+shape Supervisor wiring — `runPersonified` is the ONE place persona seams reach the built-in executors; a parallel runner silently fails to thread them (router/sandbox config never reaches the executor). (For persona⟷agent *eval* dialogue, that's a different primitive: `runConversation`/`runPersonaConversation`, §3.1.)
`src/runtime/personify/persona.ts:121` (barrel `src/runtime/index.ts:122`)

---

**`loopUntil`** · `/runtime` · `@experimental`
THE K-round driver⟷worker persistent-artifact loop. One `step` child (worker turn) per round; `fold` accumulates each settlement into the running state (the persistent artifact); `until` is the deployable non-oracle stop. The conserved budget pool **is** the K bound — once `spawn` fails closed the loop stops, and budget-exhausted-before-`until` is a concrete blocker (fail loud, never a vacuous done). `until` reads trace **findings** (`AnalystFinding[]`), not a fresh raw verdict — the selector≠judge discipline. (Absent a wired analyst on this surface the firewall stays dormant and `until` is consulted with an empty findings array — never a fabricated finding.)

```ts
function loopUntil<Task, State, D>(seed: State, spec: LoopUntilSpec<Task, State, D>): CombinatorShape<Task, D>
// LoopUntilSpec = { step(rootTask, state: LoopUntilState<State>, ctx): unknown;
//   fold(prior, settled: Settled<Outcome<D>>): LoopUntilState<State>;
//   until(state, findings: ReadonlyArray<AnalystFinding>): Outcome<D> | null; label?(round): string }
// LoopUntilState<State> = { round: number; value: State }
```
```ts
const shape = loopUntil({ draft: '' }, {
  step: (task, state) => ({ prompt: `improve this draft toward: ${task}\n\n${state.value.draft}` }),
  fold: (prior, settled) => settled.kind === 'done'
    ? { round: prior.round, value: { draft: (settled.out as any).deliverable ?? prior.value.draft } }
    : prior,
  until: (state) => state.round >= 4 ? { kind: 'done', deliverable: state.value } : null,
})
await runPersonified({ persona, shape, task, budget })
```
**Do NOT** write a `while(notDone)` hand-loop / bespoke K-round steering loop — `loopUntil` IS it, and it gets conserved-budget metering (equal-k by construction), journal/replay, fail-loud blockers, and the selector≠judge firewall for free.
`src/runtime/personify/combinators.ts:169` (barrel `src/runtime/index.ts:111`)

---

**`fanout`** · `/runtime` · `@experimental`
Breadth combinator (the dual of `loopUntil`'s depth, on the same `Scope`). Spawn one worker child per item in ONE round (bounded by fail-closed pool admission), drain via `scope.next()`, then either run ONE separate synthesis child (`synthesize` ⇒ map-reduce) or return the best-valid child via the single-sourced selector (`defaultSelectWinner` — selector≠judge, never a re-rank behind a driver). Zero admitted children, or a rejected synthesis child, is a concrete blocker.

```ts
function fanout<Task, Item, D>(items: ReadonlyArray<Item>, opts: FanoutOptions<Item, D>): CombinatorShape<Task, D>
// FanoutOptions = { itemTask(item, index, ctx): unknown; label?(item, index): string;
//   synthesize?: { synthesisTask(gathered: ReadonlyArray<Settled<Outcome<D>>>, ctx): unknown;
//                  collect(settled: Settled<Outcome<D>>): Outcome<D> } }
```
```ts
const shape = fanout(angles, {
  itemTask: (angle) => ({ prompt: `research angle: ${angle}` }),
  synthesize: { synthesisTask: (done) => ({ prompt: `merge:\n${done.map(d => JSON.stringify(d.out)).join('\n')}` }),
                collect: (s) => s.out as Outcome<Report> },
})
```
**Do NOT** `Promise.all` over N worker calls + manual argmax/merge — that bypasses the budget pool and silently breaks equal-compute claims.
`src/runtime/personify/combinators.ts:92` (barrel `src/runtime/index.ts:109`)

---

**`panel`** · `/runtime` · `@experimental`
M-judges-over-ONE-artifact. Spawn M judge children over the same input, drain, fold them into a verdict via a pure WRITE-ONLY `merge` (a judge's output never reaches another judge's task; `merge` never spawns or re-ranks). `down` judges are excluded from the denominator (like an infra-errored cell). No-quorum is a concrete blocker. The rubric lives in each judge persona's profile, not the combinator.

```ts
function panel<Task, Artifact, D>(spec: PanelSpec<Artifact, D>): CombinatorShape<Task, D>
// PanelSpec = { judges: ReadonlyArray<PanelJudge>; judgeTask(artifact, judge, ctx): unknown;
//   merge(verdicts: ReadonlyArray<PanelVerdict>, artifact): Outcome<D> }
// PanelJudge = { label: string; weight? }; PanelVerdict = { judge; verdict?: DefaultVerdict; output?; down: boolean }
```
**Do NOT** feed one judge's score into another or re-rank behind a driver — that's the selector=judge coupling the architecture forbids.
`src/runtime/personify/combinators.ts:214` (barrel `src/runtime/index.ts:112`)

---

**`verify`** · `/runtime` · `@experimental`
2-node implement→verifier gate. An IMPLEMENT child produces a candidate; a SEPARATE VERIFIER child grades it; only a `valid` verifier verdict ships. Any other outcome is a named blocker carrying the failure verbatim (a failed gate is never coerced to `done`). The gate rubric is the verifier persona's.

```ts
function verify<Task, Candidate, D>(spec: VerifySpec<Task, Candidate, D>): CombinatorShape<Task, D>
// VerifySpec = { implement(rootTask, ctx): unknown; verifier(candidate: Settled<Outcome<Candidate>>, ctx): unknown;
//   collect(candidate, verdict: DefaultVerdict): Outcome<D>; implementLabel?; verifierLabel? }
```
**Do NOT** inline "generate, then self-check with the same model, ship if ok" — `verify` forces a distinct verifier agent and a fail-loud gate.
`src/runtime/personify/combinators.ts:274` (barrel `src/runtime/index.ts:114`)

---

**`widen` / `flatWidenGate`** · `/runtime` · `@experimental`
Streaming progressive-widening (MCTS-PW). Spawn seed lineages, then REACT to each `scope.next()`: on each settled child consult `spec.gate` and, when it returns `widen`, spawn AT MOST ONE more child toward the chosen lineage under the remaining pool. **FLAT by default** (`flatWidenGate()` never widens). `promising` MUST derive from trace findings, never a child's raw verdict — so the default keeps the selector≠judge collision dormant. It is the mechanism the diverse-strategy-vs-blind gate runs with; kept flat until that gate returns positive.

```ts
function widen<Task, Seed, D>(spec: WidenSpec<Seed, D>): CombinatorShape<Task, D>
function flatWidenGate<D>(): ScopeWidenGate<D>
// WidenSpec = { seeds; seedTask(seed, index, ctx); gate: ScopeWidenGate<D>;
//   widenTask(toward: WidenLineage<D>, ctx); synthesize(gathered, ctx): Outcome<D> }
```
**Do NOT** hand-roll a best-first/MCTS that reads child scores to decide where to expand — that's selector=judge. Use `flatWidenGate()` until your findings-driven gate is proven.
`src/runtime/personify/combinators.ts:323` (`flatWidenGate:377`; barrel `src/runtime/index.ts:115`,`:110`)

---

**`pipeline`** · `/runtime` · `@experimental`
Sequential composition. Run stages in order, feeding each stage's `done` deliverable into the next stage's task. The first `blocked` stage short-circuits — its blockers ARE the pipeline's. The terminal stage's deliverable is the pipeline's.

```ts
function pipeline<Task, D>(stages: ReadonlyArray<PipelineStage<Task, unknown, unknown>>): CombinatorShape<Task, D>
// PipelineStage = { label: string; feed(prior, ctx, rootTask): unknown; collect(settled: Settled<Outcome<StepOut>>): Outcome<StepOut> }
```
**Do NOT** chain `await`s by hand passing outputs along — `pipeline` meters each stage against the conserved pool and short-circuits with real blockers.
`src/runtime/personify/combinators.ts:54` (barrel `src/runtime/index.ts:113`)

---

**`definePersona`** · `/runtime` · `@experimental`
Freezes a `Persona` — the GENOME record for a personified run: the root `AgentSpec` (`profile` + `harness` + optional BYO `executor`), a goal `directive`, a `context` blob (who the loop acts as), and the executor `seams`/`registry`. Pure data, no behavior — content lives here, structure lives in the shape. Fails loud at definition time if executors supply neither a registry nor a seams bag (built-in runtimes read seams off `ExecutorContext`).

```ts
function definePersona<D = unknown>(input: DefinePersonaInput<D>): Persona<D>
// DefinePersonaInput = { name: string; root: AgentSpec; directive: string; context: PersonaContext;
//   executors: { registry?: ExecutorRegistry; seams?: Readonly<Record<string,unknown>> };
//   extensions?: Readonly<Record<string,unknown>> }
// PersonaContext = { role: string; notes?: string; [key: string]: unknown }
```
```ts
const persona = definePersona({
  name: 'coder', root: { profile: coderProfile, harness: null },
  directive: 'resolve the failing tests', context: { role: 'senior staff engineer' },
  executors: { seams: { router: { routerBaseUrl, routerKey, model: 'deepseek-v4-pro' } } },
})
```
**Do NOT** invent a "profile-seam"/agent-config wrapper to carry model+prompt+tools+role into a loop — `definePersona` is that record, and the `AgentProfile` it points at already carries `systemPrompt + skills + tools + mcp + knowledge + memory + rag` (§3.2).
`src/runtime/personify/persona.ts:54` (types `src/runtime/personify/types.ts`; barrel `src/runtime/index.ts:122`)

---

**`createSupervisor`** · `/runtime` · `@experimental`
The keystone Supervisor factory. Owns the conserved budget pool, the spawn journal, the abort cascade, the OTP intensity breaker, and the root handle. `run(root, task, opts)` executes a root `Agent` to a typed `SupervisedResult`; `attach(handle)` wires live view/signal/abort. Budget is an atomically-reserved conserved pool (reserve-on-spawn, refund-on-settle, fail-closed admission) so `Σk(treatment) == Σk(blind)` **by construction**. The journal content-addresses each result so replay rehydrates the exact `Settled` the driver branched on. A no-winner is never coerced to a best-effort output.

```ts
function createSupervisor<Task, Out>(): Supervisor<Task, Out>
// Supervisor.run(root: Agent<Task,Out>, task: Task, opts: SupervisorOpts): Promise<SupervisedResult<Out>>
// SupervisorOpts = { budget: Budget; runId: NodeId; journal: SpawnJournal; blobs: ResultBlobStore;
//   executors: ExecutorRegistry; maxDepth?; maxRestarts?; withinMs?; now?; signal?; hooks?: RuntimeHooks }
```
```ts
const supervisor = createSupervisor<unknown, Outcome<D>>()
const result = await supervisor.run(myDriverAgent, task, {
  budget: { maxIterations: 20, maxTokens: 1_000_000 },
  runId: 'run:1', journal: new InMemorySpawnJournal(), blobs: new InMemoryResultBlobStore(),
  executors: createExecutorRegistry(), maxDepth: 3 })
```
**Do NOT** build your own orchestrator that spawns sub-agents and tallies cost — that hand-roll is exactly where equal-compute claims break. Prefer `runPersonified`/`runAgentic` above it for most work.
`src/runtime/supervise/supervisor.ts:64` (`createRootHandle:235`; types `src/runtime/supervise/types.ts`; barrel `src/runtime/index.ts:304`)

---

**`createScope` / `settledToIteration`** · `/runtime` · `@experimental`
`createScope` builds the budget-conserving reactive `Scope` an `Agent.act` runs inside — `spawn` (reserve atomically, fail-closed), `next` (wait n=1 over the live set, strict recorded-seq order, replay-safe), `send` (steer a running child out-of-band), `view`, `budget`. Mostly internal (the Supervisor builds root + child scopes); reach for it only when implementing a custom Scope host. `settledToIteration` projects a `done` Settled into a kernel `Iteration` so the single-sourced selector serves both substrates.

```ts
function createScope<Out>(args: ScopeArgs): Scope<Out>
function settledToIteration<Out>(settled: Settled<Out>): Iteration<unknown, Out>
// Scope.spawn<C extends Out>(agent, task, opts: SpawnOpts): { ok: true; handle } | { ok: false; reason: 'budget-exhausted'|'depth-exceeded' }
// Scope.next(): Promise<Settled<Out> | null>;  Scope.send(nodeId, msg): boolean
```
```ts
// inside a custom driver's act(task, scope):
const res = scope.spawn(workerChild, workerTask, { budget: perChild, label: 'shot:0' })
if (!res.ok) return { kind: 'blocked', blockers: [res.reason] }
const settled = await scope.next()
if (settled?.kind === 'done') {
  const winner = defaultSelectWinner([settledToIteration(settled)])
}
```
**Do NOT** create your own selection logic over settled children or manage your own budget counters — `settledToIteration` + `defaultSelectWinner` are the one selector; the Scope's pool is the one budget authority.
`src/runtime/supervise/scope.ts:117` (`settledToIteration:503`; barrel `src/runtime/index.ts:301`)

---

**`createExecutor` / `createExecutorRegistry` / the `Executor` port** · `/runtime` · `@experimental`
The leaf-runtime substrate both reactive entrypoints resolve children through. `createExecutor({ backend })` is the ONE built-in executor (backend-as-data: `router` / `router-tools` / `bridge` / `cli` / `sandbox`). `createExecutorRegistry()` is the open resolver mapping an `AgentSpec` to a built-in OR a BYO executor. The `Executor` interface is the open extension point — implement it directly to bring your own agent. Every metered runtime reports through the same normalized `UsageEvent` channel so the conserved pool meters them identically; `cli` is `budgetExempt`. `router-tools` is the OFF-box tool-using agentic loop (chat→tool_calls→`executeToolCall`→repeat), unaffected by sandbox egress allowlists.

```ts
function createExecutor(config: ExecutorConfig): ExecutorFactory<unknown>
function createExecutorRegistry(): ExecutorRegistry
// ExecutorConfig = ({backend:'router'} & RouterSeam) | ({backend:'router-tools'} & RouterToolsSeam)
//   | ({backend:'bridge'} & BridgeSeam) | ({backend:'cli'} & CliSeam)
//   | ({backend:'sandbox'; harness?: BackendType} & SandboxSeam)
// interface Executor<Out> { runtime: Runtime; budgetExempt?: boolean;
//   execute(task, signal): Promise<ExecutorResult<Out>> | AsyncIterable<UsageEvent>;
//   deliver?(msg): void; teardown(grace): Promise<{destroyed}>; resultArtifact(): {...} }
```
```ts
const registry = createExecutorRegistry()
registry.register('my-agent', createExecutor({ backend: 'router-tools', routerBaseUrl, routerKey, model, tools, executeToolCall }))
// or BYO: pass `executor: myExecutor` on the AgentSpec to bypass the registry.
```
**Do NOT** write a per-vendor adapter or a closed backend switch — a parallel won't report through `UsageEvent` and breaks conserved-pool metering / equal-k.
`src/runtime/supervise/runtime.ts:775` (`createExecutorRegistry:811`, `ExecutorConfig:768`; `Executor` type in `supervise/types.ts`; barrel `src/runtime/index.ts:293-294`)

---

**`runLoop` / `defaultSelectWinner`** · `/runtime` · `@experimental`
The round-synchronous loop kernel (the OTHER substrate — what most sandbox benches drive). Per round: `driver.plan(task, history)` → N tasks → one sandbox/iteration each (bounded by `maxConcurrency`, round-robin `agentRuns`) → `streamPrompt` → `output.parse` → `validator.validate` → `driver.decide`. Owns iteration accounting, concurrency, abort, cost+token aggregation, trace emission, box teardown. Delegates WHAT runs (`AgentRunSpec.profile`), HOW outputs decode (`OutputAdapter`), HOW they score (`Validator`), and topology (`Driver`). `defaultSelectWinner` (best-valid-score, ties→earliest) is the one selector both substrates reuse.

```ts
function runLoop<Task, Output, Decision>(options: RunLoopOptions<Task, Output, Decision>): Promise<LoopResult<Task, Output, Decision>>
// RunLoopOptions = { driver: Driver<Task,Output,Decision>; agentRun?: AgentRunSpec<Task>; agentRuns?: AgentRunSpec<Task>[];
//   output: OutputAdapter<Output>; validator?: Validator<Output>; task: Task; ctx: ExecCtx;
//   maxIterations?; maxConcurrency?; runId?; now?; selectWinner?; onWorkerBox?; lineage? }
// Driver = { name?; plan(task, history): Promise<Task[]>; decide(history): Decision|Promise<Decision>; describePlan?; selectWinner? }
function defaultSelectWinner<Task,Output>(iterations): LoopWinner | undefined
```
**Do NOT** hand-roll a `new Sandbox()`+acquire+stream+parse+delete loop or a second winner-selector. Pick `runLoop` for sandbox round-synchronous benches, the `Supervisor` for new reactive work — don't invent a third substrate.
`src/runtime/run-loop.ts:135` (`RunLoopOptions:69`, `defaultSelectWinner:983`; `Driver` at `src/runtime/types.ts:138`; barrel `src/runtime/index.ts:209`)

---

**`openSandboxRun`** · `/runtime` · `@experimental`
The ONE harness-agnostic seam for running an agent in a sandbox over a **persistent, resumed** artifact: `start()` mints a session on a fresh box, `resume()` continues THE SAME server-side session across turns, `close()` tears it down. Returns the box, sessionId, and a typed `Deliverable<Out>` per turn (parsed from events OR read off the box FS — the `artifact` variant does a post-turn `box.fs.read` with retry/backoff for large files that truncate in the chat stream). Distinct from `runLoop`'s multi-round fresh-box-per-round kernel — this is one persistent session you resume.

```ts
function openSandboxRun<Out>(client: SandboxClient, options: OpenSandboxRunOptions, deliverable: Deliverable<Out>): Promise<SandboxRun<Out>>
// Deliverable<Out> = { kind:'events'; fromEvents(events): Out } | { kind:'artifact'; path: string; fromArtifact(raw, events): Out }
// SandboxRun = { box; sessionId; start(prompt): Promise<TurnResult<Out>>; resume(prompt): Promise<TurnResult<Out>>; close(): Promise<void> }
// OpenSandboxRunOptions = { agentRun: AgentRunSpec<string>; signal: AbortSignal; hooks?; runId?; scenarioId?; now?; maxConcurrency?; readRetryDelayMs? }
```
**Do NOT** hand-roll `new Sandbox`+acquire+stream+`box.fs.read`+delete, or a per-domain copy — route every new sandbox-rollout-with-resume caller through this (the harness is just `sandboxOverrides.backend.type`).
`src/runtime/sandbox-run.ts:104` (`Deliverable:50`, `SandboxRun:68`, `OpenSandboxRunOptions:79`; barrel `src/runtime/index.ts:228`)

#### The conversation/eval layer — persona⟷agent dialogue (`src/conversation/`)

A DIFFERENT layer from `runPersonified`/`loopUntil` above: those run a genome through a topology over the Supervisor (recursive-atom execution). These run a **worker agent under test** in a multi-round dialogue against a **persona driver** (a simulated user) over a persistent transcript — the eval/dispatch layer. Profiles-vs-profiles; **only the worker is metered** (the persona is the test harness, not billed against the agent).

**`runPersonaConversation`** · root `.` (barrel `src/index.ts:84`) · `src/conversation/run-persona.ts:130`
The persona loop runner. `worker: AgentProfile` (under test) converses K rounds with `persona: PersonaDriver` — either `{ kind: 'profile', profile }` (an LLM role-playing the user from its facts) or `{ kind: 'scripted', turns }` (a deterministic fast-path). `backendFor(profile, role)` and `systemPromptOf(profile)` make a profile runnable; `maxTurns` caps the dialogue (required for a `profile` persona). Returns `{ transcript, turns, halted, costUsd, tokensIn, tokensOut }` — cost is **worker-only**.
```ts
const r = await runPersonaConversation({
  worker, persona: { kind: 'profile', profile: userSim },
  backendFor, systemPromptOf, maxTurns: 8,
})
```
**`runPersonaDispatch`** wraps the runner as a `ProfileDispatchFn` so it drops straight into `runProfileMatrix({ dispatch })` — the same loop serves one cell and a whole matrix, **replacing the per-agent hand-rolled `dispatchWithSurface` bridges** it was built to kill.

**`runConversation`** · root `.` · `src/conversation/run-conversation.ts` — the lower-level two-profile turn loop `runPersonaConversation` is built on (two `AgentProfile`s head-to-head over the transcript). Use `runPersonaConversation` unless you need raw two-agent control.

**Do NOT** hand-roll a per-agent eval dispatch or a two-agent turn loop — `runPersonaConversation` + `runPersonaDispatch` are it, and they keep worker-only metering and eval/prod parity by construction.

### 3.2 The Genome — who the agent is + what it can do

Three distinct `AgentProfile` types share a name and are routinely confused. The teaching point: the genome is **ONE combined surface** — not separate skill/tool/prompt knobs you wire by hand.

| Type | Package | Role | Can boot an agent? |
|---|---|---|---|
| **`AgentProfile`** (the genome) | owned by `@tangle-network/agent-interface`; `/runtime` re-exports it (and `@tangle-network/sandbox` re-exports it too) for back-compat | the runnable run-config | **Yes** |
| **`AgentProfile`** (agent-eval cell) | `@tangle-network/agent-eval` | a flat `(model,skills,prompt,tools)` fingerprint keying a scorecard cell | No — pins WHICH variation |
| **`AgentProfile`** (sectioned prompt-genome) | `@tangle-network/agent-eval` `profile` namespace | the prompt CONTENT (role/env/toolConventions/skills/domain sections) the optimizer patches | No — it's the text scored |

---

**`AgentProfile`** (sandbox/runtime genome) · `/runtime` · stable
The provider-neutral run-config the executor boots an agent with — the one object that is *who the agent is* (`prompt.systemPrompt` + `resources.skills`) and *what it can do* (`tools` + `mcp`), with `resources.files` as its knowledge/memory mounts and `mcp` as retrieval/delegation wiring. There is no separate "skill knob" or "tool knob" — you mutate fields on this one struct, which is exactly what the optimizer evolves.

```ts
interface AgentProfile {
  name?; description?; version?; tags?;
  prompt?: AgentProfilePrompt;        // { systemPrompt?: string; instructions?: string[]; ... }
  model?: AgentProfileModelHints;     // { default?; small?; provider?; metadata? }
  permissions?: Record<string, AgentProfilePermission>;
  tools?: Record<string, boolean>;
  mcp?: Record<string, AgentProfileMcpServer>;
  subagents?: Record<string, AgentSubagentProfile>;
  resources?: AgentProfileResources;  // { files?; tools?; skills?; agents?; commands?; instructions?; failOnError? }
  hooks?; modes?; confidential?; metadata?; extensions?
}
```
**Do NOT** invent a per-product "skill config" object, a separate "tool registry", or a "profile-seam" re-bundling prompt+model+tools — this struct already IS that bundle. Don't hand-merge a delegation/retrieval MCP — `composeProductionAgentProfile` does it. `resources.skills`/`resources.files` ARE the knowledge surface.
`node_modules/@tangle-network/sandbox/dist/sandbox-BQbq1EGP.d.ts:190` (re-exported `src/runtime/index.ts:15`); example real profiles `src/profiles/coder.ts`, `src/profiles/ui-auditor/profile.ts`

---

**`AgentSurfaces` + `resolveSubjectPath` / `validateSurfaces`** · `/agent` · stable
The declarative map of on-disk paths the self-improvement loop may edit on an agent's behalf — the FULL mutable-coordinate set. `systemPrompt`/`tools`/`personas`/`knowledge` are DIRECTORIES (loop appends `<section>.md`, `<tool>/README.md`, `<persona>.yaml`); `rubric`/`outputSchema` are FILES. Every parsed `FindingSubject` resolves through this map to a real path via `resolveSubjectPath`; a finding targeting an undeclared surface is REFUSED (not written to a made-up path). `mcp`/`memory`/`rag`/`knowledge` are how you give an agent retrieval and memory — declare them and the loop can grow them.

```ts
interface AgentSurfaces {
  systemPrompt: string; tools: string; rubric: string; knowledge: string; personas: string; // required
  scaffolding?: string; memory?: string; rag?: string; outputSchema?: string                // optional
}
resolveSubjectPath(subject: FindingSubject, surfaces, repoRoot): ResolvedSurface | null
validateSurfaces(surfaces, repoRoot): ReadonlyArray<SurfaceValidationIssue>
```
**Do NOT** hardcode per-vertical paths or `existsSync(...)` skips, or build a separate "where do knowledge/memory/rag docs go" mapping per agent — declare the surface here and the substrate routes every `FindingSubject` kind. An omitted optional surface is correct (loop refuses those findings); a fabricated path is a bug.
`src/agent/surfaces.ts:37` (`resolveSubjectPath:86`, `validateSurfaces:197`; barrel `src/agent/index.ts:45`)

---

**`defineAgent`** · `/agent` · stable
The typed, validated manifest factory — one ~50-line call declaring an agent's surfaces, rubric, `runtime.act`, personas, analyst kinds, and auto-apply policy, validating the surfaces against disk synchronously and throwing `AgentManifestError` on any missing surface (plus a rubric-weight sanity check, ~1.0). Every vertical ships ONE `defineAgent({...})` + a thin loop invocation — no per-vertical glue. `runtime.act` MUST stream (`events`) + resolve `output` after drain — never collapse to a single Promise (it breaks streaming + the capture-integrity guard).

```ts
function defineAgent<TPersona=unknown, TRunOutput=unknown>(manifest: AgentManifest<TPersona, TRunOutput>): AgentManifest<...>
// AgentManifest = { id; repoRoot; surfaces: AgentSurfaces; rubric: AgentRubric<TRunOutput>;
//   runtime: { act: (persona, ctx: AgentRunContext) => { events: AsyncIterable<RuntimeStreamEvent>; output: Promise<TRunOutput> } };
//   personas: () => Promise<readonly TPersona[]>; analystKinds: readonly TraceAnalystKindSpec[];
//   analyst: AnalystConfig; autoApply?: AutoApplyPolicy }
```
```ts
import { defineAgent, createSandboxAct } from '@tangle-network/agent-runtime/agent'
export const legalAgent = defineAgent({
  id: 'legal-agent', repoRoot: process.cwd(),
  surfaces: { systemPrompt: 'prompt', tools: 'tools', rubric: 'eval/rubric.ts', knowledge: '.agent-knowledge', personas: 'eval/personas' },
  rubric: { dimensions: [{ id: 'citation', weight: 0.5, score: ({ output }) => scoreCitations(output) }, /* ... */] },
  runtime: { act: createSandboxAct({ baseProfile, sandboxClient, buildPrompt, output }) },
  personas: () => loadPersonas('eval/personas'),
  analystKinds: DEFAULT_TRACE_ANALYST_KINDS, analyst: { model: 'claude-sonnet-4-6@2025-04-15' },
})
```
**Do NOT** write a per-vertical manifest parser, surface-validator, or bespoke `ImprovementAdapter` — `defineAgent` + the substrate-default adapters (`createSurfaceImprovementAdapter`, `createSurfaceKnowledgeAdapter`) are the no-glue path. Don't implement `runtime.act` as a plain Promise — use `createSandboxAct`, drain with `collectAgentRun` only in non-rendering eval paths.
`src/agent/define-agent.ts:296` (`createSandboxAct` at `src/agent/sandbox-act.ts:62`; barrel `src/agent/index.ts:25`)

---

**`composeProductionAgentProfile`** · `/mcp` · stable
Composes the production sandbox `AgentProfile` = canonical base + the delegation MCP merged into `mcp` (OMITTED entirely if no sandbox key resolves — fail-closed, not a half-wired MCP) + concatenated `resources.files`, so the eval scorecard grades the SAME profile production ships (parity). `createSandboxAct` already calls it; reach for it directly only when wiring a bespoke streaming chat turn.

```ts
function composeProductionAgentProfile(baseProfile: AgentProfile, options?: ComposeProductionAgentProfileOptions): AgentProfile
// ComposeProductionAgentProfileOptions = { sandboxApiKey?; sandboxBaseUrl?; systemPrompt?; extraFiles?: AgentProfileFileMount[]; name?; env? }
```
**Do NOT** hand-merge a delegation/retrieval MCP per call site or maintain two profiles (one eval, one prod) — this is the single composition seam guaranteeing parity + fail-closed wiring.
`src/mcp/delegation-profile.ts:136` (options `ComposeProductionAgentProfileOptions:105`; consumed by `src/agent/sandbox-act.ts`; barrel `src/mcp/index.ts:40`)

> **The agent-eval cell `AgentProfile`** (`{ id; model; skills?; promptVersion?; tools?; metadata? }`, hashed by `agentProfileHash` — skills/tools order-insensitive, `id` excluded) pins WHICH variation for the scorecard; it CANNOT boot an agent. **The sectioned prompt-genome** (`{ role; environment; toolConventions; skills; domain }` under the `profile` namespace) is the prompt CONTENT — `applyDomainPatch(p, sectionId, body)` replaces one evolvable section (throws on unknown/fixed id — fail loud), `profileToSurface(p)` bridges it to the loop's string `MutableSurface`. Don't stuff a `systemPrompt` body into the cell type or build your own run fingerprint — `agentProfileHash` is it. *(These three are agent-eval substrate types, not runtime exports.)*

### 3.3 The Benchmark Harness — measure a genome

Two faces: the **bench harness** (`bench/src/*`, harness-local, drives the round-synchronous `runLoop` over external benchmarks with deterministic judges) and the **packaged suite** (`/loops`, drives the reactive `Supervisor` over an `AgenticSurface`).

---

**`AgenticSurface`** (alias `Environment`) · `/loops` (and `/runtime`)
The ONE seam a multi-turn agentic domain implements: `open(task)→ArtifactHandle`, `tools(task,handle)→AgenticTool[]`, `call(handle,name,args)→string`, `score(task,handle)→SurfaceScore`, `close(handle)`. A stateful, checkable environment the agent works over WITH TOOLS across turns. The depth/breadth drivers and authored strategies are domain-BLIND — they run over any `AgenticSurface`. **Teaching point:** profile-surface optimization MUST run on a multi-turn `AgenticSurface` — on single-shot benches (humaneval/simpleqa/math) the genome's tools/mcp/knowledge surface is DEAD because it's never invoked.

```ts
interface AgenticSurface {
  readonly name: string
  open(task: AgenticTask): Promise<ArtifactHandle>
  tools(task, handle): Promise<AgenticTool[]>
  call(handle, name, args: Record<string,unknown>): Promise<string>
  score(task, handle): Promise<SurfaceScore>   // SurfaceScore = { passes; total; errored }
  close(handle): Promise<void>
}
```
**Do NOT** build a bespoke tool-loop harness or per-benchmark agent runner — implement these 5 hooks and `runAgentic`/`runBenchmark` drive any strategy over them. The write tool MUST be path-jailed off the check (the agent cannot edit the test).
`src/runtime/strategy.ts:74` (`SurfaceScore:66`; `Environment` alias `src/runtime/run-benchmark.ts:30`; barrel `src/runtime/index.ts:239`)

---

**`runAgentic`** · `/loops` (and `/runtime`) · stable
Runs a `Strategy` through the keystone Supervisor as one recursive `Agent.act` over a conserved-budget Scope, on one `AgenticSurface`+`AgenticTask`. Returns the harness-verified score + progression curve + cost vector (real router tokens, priced usd, wall ms) stamped from the pool. Equal-k holds by construction; the same primitive nests (`maxDepth:3`). `depth` = one persistent artifact carried across analyst-steered shots (the analyst reads the trajectory, never the score); `breadth` = K independent rollouts, the deployable verifier picks the best. Fails loud (throws) on no-winner/blocked.

```ts
async function runAgentic(opts: RunAgenticOptions): Promise<AgenticRunResult>
// RunAgenticOptions extends AgenticOptions { surface; task; hooks?: RuntimeHooks; strategy?: Strategy;
//   mode?: 'depth'|'breadth'; budget: number; rootBudget?: Budget }  // default mode 'depth'
// AgenticRunResult = { mode; score; resolved; completions; progression: number[]; shots; usd; ms; tokens }
```
```ts
const result = await runAgentic({ surface, task, routerBaseUrl, routerKey, model, innerTurns: 4,
  analystInstruction: tunedSteererPrompt /* the GEPA knob — the analyst IS the steerer */,
  mode: 'depth', budget: 4 })
```
**Do NOT** hand-roll a `Supervisor.run()` with a journal/blob-store/registry, or a depth/breadth loop. Prefer this over the round-synchronous `runLoop` kernel for new recursive work.
`src/runtime/strategy.ts:985` (`AgenticRunResult` type `:509`, `RunAgenticOptions` `:969`; `depthDriver:531`/`breadthDriver` reference impls; barrel `src/runtime/index.ts:249`)

---

**`defineStrategy` + `Strategy` (`sample`/`refine`) + `StrategyCtx`** · `/loops` (and `/runtime`) · stable
`defineStrategy(name, body)` authors a custom strategy in ~15 lines from two steps: `ctx.shot(spec?)` runs one harness-scored worker attempt over an artifact; `ctx.critique(messages)` is the firewalled analyst (trajectory in, **never** scores). The body gets `surface.open`/`close` ONLY (`StrategyArtifacts`) — raw `call()`/`score()` are withheld so it can't peek the check; `close()` is idempotent so a double-close in a `finally` doesn't kill the run. **HARNESS-VERIFIED by construction:** the deliverable score is computed from the shots the harness actually brokered+scored via `surface.score()`, NEVER the value the (possibly authored/adversarial) body returns. Built-ins `sample` (breadth/best-of-N) and `refine` (depth/iterate-with-feedback) are `Strategy` values; `depthDriver`/`breadthDriver` are their hand-written reference impls.

```ts
function defineStrategy(name: string, run: (ctx: StrategyCtx) => Promise<StrategyResult>): Strategy
// StrategyCtx = { surface: StrategyArtifacts /* open/close only */; task; opts; budget; scope;
//   shot(spec?: ShotSpec): Promise<ShotResult|null>;
//   critique(messages): Promise<string|null>;                 // findings-extracting analyst
//   consult(messages, instruction): Promise<string|null>;     // RAW verdict-capable analyst channel
//   listTools(handle): Promise<Array<{ name; description? }>> }
// StrategyResult = { score; resolved; completions; progression: number[]; shots }
// const sample: Strategy; const refine: Strategy; also adaptiveRefine, sampleThenRefine
```
```ts
const sampleThenRefine = defineStrategy('sampleThenRefine', async (ctx) => {
  const h = await ctx.surface.open(ctx.task)
  let best = await ctx.shot({ handle: h })
  for (let i = 1; i < ctx.budget && best && best.score < 1; i++) {
    const steer = await ctx.critique(best.messages); if (!steer) break
    best = await ctx.shot({ handle: h, messages: best.messages, steer })
  }
  await ctx.surface.close(h)
  return { score: best?.score ?? 0, resolved: (best?.score ?? 0) >= 1, completions: 0, progression: [], shots: 0 }
})
```
**Do NOT** hand-write a full Agent/driver with `scope.spawn`/`scope.next` ceremony for a new strategy, give the body raw `score()`/`call()` access, or trust a body-returned score — `defineStrategy` re-verifies via the harness. Copy `depthDriver`/`breadthDriver`, don't re-derive them.
`src/runtime/strategy.ts:744` (`Strategy:656`, `sample:666`/`refine:670`, `StrategyCtx:721` [`consult:736`, `listTools:740`], `StrategyArtifacts:714`, `StrategyResult:704`; barrel `src/runtime/index.ts:245`)

---

**`runBenchmark`** · `/loops` (and `/runtime`) · stable
Runs the requested strategies (default `[sample, refine]`) over a list of `AgenticTask`s on one `Environment` at equal budget through the Supervisor, scored by the Environment's own check. Returns a `BenchmarkReport`: per-strategy means, the full per-task×per-strategy cell table (the losses an optimizer consumes), the Pareto frontier on (score↑, $/task↓), and the paired-bootstrap lift of `refine` over `sample`. A task whose rollouts fail is **excluded + reported** in `perTask` with the error — never silently dropped or scored 0.

```ts
async function runBenchmark(cfg: BenchmarkConfig): Promise<BenchmarkReport>
// cfg = { environment: Environment; tasks: AgenticTask[]; worker: AgenticOptions; strategies?: Strategy[];
//   budget?; concurrency?; onTask?; hooks?: RuntimeHooks }
// BenchmarkReport = { n; excluded; perStrategy; perTask: BenchmarkTaskRow[]; pareto: string[]; refineVsSample?: BenchmarkLift }
```
```ts
const report = await runBenchmark({
  environment: createCommit0Environment(rows), tasks: rows.map(rowToTask),
  worker: { routerBaseUrl, routerKey, model, innerTurns: 4 },
  strategies: [sample, refine, mySoloStrategy], budget: 3, concurrency: 3 })
console.log(report.refineVsSample, report.pareto)
```
**Do NOT** write your own strategy-comparison loop, paired-bootstrap, or Pareto computation — `runBenchmark` imports `pairedBootstrap`/`paretoFrontier` from agent-eval. Don't score a failed task as 0.
`src/runtime/run-benchmark.ts:132` (`BenchmarkReport:95`, `BenchmarkConfig:32`; imports `pairedBootstrap`/`paretoFrontier` at `:16`; barrel `src/runtime/index.ts:206`)

---

**`ADAPTERS` + `resolveAdapter`** · `bench/src/adapters.ts` (harness-local, not a package export)
The single source of truth mapping a benchmark key to its `BenchmarkAdapter` factory. Wired keys: `swe-bench, terminal-bench, aec-bench, commit0, programbench, appworld, appworld-react, enterpriseops-gym, cad-design, cadbench, cadgenbench, frames, finsearchcomp, simpleqa, hotpotqa, humaneval, mind2web, trata-hedge`. Adding one is ONE import + one registry line; `gate-cli.mts`, `aec-gate.mts`, `corpus-replay.mts`, `research-gate.mts`, and `trata-gate.mts` all read it. `resolveAdapter` fails loud with the known keys.

```ts
export const ADAPTERS: Record<string, () => BenchmarkAdapter>
export function resolveAdapter(key: string): BenchmarkAdapter  // throws with the key list if unknown
```
**Do NOT** hand-maintain a per-script `switch(bench)` or a local benchmark-factory map.
`bench/src/adapters.ts:27` (`resolveAdapter:56`)

---

**`BenchmarkAdapter`** · `bench/src/benchmarks/types.ts`
The interface every external benchmark implements so the loop can be A/B'd against the benchmark's OWN deterministic judge. You supply the prompt (`loadTasks`), the deliverable parser (`output`, defaulting to final-answer text), and the deterministic `judge` (delegates to the benchmark's published harness — no self-authored scoring). `goldArtifact` self-verifies the judge before spending tokens; `output`/`leafClient` let a benchmark own its deliverable/worker.

```ts
interface BenchmarkAdapter {
  readonly name: string                                       // :38
  preflight(): Promise<void>                                  // :40 — throw with the install step if the harness is absent
  loadTasks(opts?: LoadOptions): Promise<BenchTask[]>         // :41
  judge(task: BenchTask, artifact: string): Promise<BenchScore>  // :43 — BenchScore = { resolved; score; detail? }
  goldArtifact(task: BenchTask): Promise<string | undefined>  // :45
  output?: OutputAdapter<string>                              // :50
  leafClient?: (cfg: { model; routerBaseUrl; routerKey }) => unknown  // :56
}
```
**Do NOT** write a bespoke per-benchmark run script with its own scoring, or self-author a judge — delegate to the benchmark's harness and fail loud when Docker/the harness is missing.
`bench/src/benchmarks/types.ts:37`

---

**`runGate` (the diverse-vs-blind gate)** · `bench/src/gate.ts`
Runs one gate — N benchmark instances × two arms (each arm a `fanout` of `k = strategies.length` children through the `Supervisor`), judged by the adapter, the trajectory ledger backing both the resolve metric and the cross-arm equal-k proof. The conserved budget pool makes the **equal-compute invariant** hold by construction (both arms spawn the same k children); the winning child's deployable verdict (`defaultSelectWinner`, replayed off the journal) decides resolution. Fails loud (`< 2 strategies` throws).

```ts
async function runGate(opts: RunGateOptions): Promise<GateReport>
// opts = { adapter: BenchmarkAdapter; strategies: string[] /* k = strategies.length */;
//   n?; ids?; split?; concurrency?; …worker seam }
```
```ts
const report = await runGate({
  adapter: resolveAdapter('enterpriseops-gym'),
  strategies: ['solve directly and concisely', 'check state first, then act', …],
  n: 20, concurrency: 3 })
```
**Do NOT** write a batch-blind/batch-oracle/compare loop, your own usage capture, or your own equal-k bookkeeping — the conserved pool gives compute-matched arms by construction.
`bench/src/gate.ts:325` (`RunGateOptions`)

---

**`runAgentic` / `defineStrategy` (author a topology) + `llmAnalyst` (the firewalled steer)**
A single arm's topology is a `Strategy` value, not an `Arm` object. Use `runAgentic({ mode: 'depth'|'breadth', … })` for the packaged depth (one persistent artifact carried across analyst-steered shots) / breadth (K independent rollouts, verifier picks best) shapes, or `defineStrategy(name, body)` to author a custom one in ~15 lines (`ctx.shot` + `ctx.critique`) — see §3.2. The steer the analyst returns is HARNESS-VERIFIED by construction (trajectory in, never the score), and `llmAnalyst` (one router call over the last attempt's output + trace tail + judge failure-detail) is the off-the-shelf `AnalystFn` a strategy reads via `ctx.critique`.

```ts
const llmAnalyst = (cfg: { routerBaseUrl; routerKey; model }): AnalystFn  // AnalystFn = (history, task?) => Promise<string>
```
**Do NOT** write a fresh "read the trace and suggest a fix" prompt or reach for `routerChatWithUsage` directly — `llmAnalyst` already encodes the verdict-as-ground-truth + selector≠judge firewall; package the move set with `runAgentic`/`defineStrategy`, not a hand-rolled per-arm loop.
`bench/src/sandbox-run.ts:58` (`llmAnalyst`, `AnalystFn:50`, `SteerHistory:39`); `src/runtime/strategy.ts` (`runAgentic`/`defineStrategy`)

---

**`sandboxAgentRun`** · `bench/src/sandbox-run.ts`
Builds the standard sandbox `AgentRunSpec<string>` the kernel injects as the worker: the cost-dial backend (`backendType`), the in-box model provider, optional box env, and the developer's `AgentProfile` (the genome — spread through verbatim). **Box-credential invariant:** model auth is the BOX'S OWN provisioned credential; `backend.model` pins provider/model/baseUrl ONLY — never pass an external router key into the box (the egress proxy rejects it → 403, empty output). Cheap router models (deepseek/kimi/glm) need `provider: 'openai-compat'` or they 404 in-box. **This is the "profile seam" an agent reinvents** — the genome flows in via `profile`. (Lives in `bench/`, not the package.)

```ts
function sandboxAgentRun(opts: { model: string; routerBaseUrl: string; backendType?: WorkerBackendType;
  provider?: string; name?: string; taskToPrompt?: (t)=>string; env?: Record<string,string>;
  profile?: AgentProfile }): AgentRunSpec<string>
// WorkerBackendType = BackendType (the SDK's: 'opencode'|'hermes'|'claude-code'|'codex'|'kimi-code'|'pi'|…)
```
**Do NOT** hand-build a profile→sandbox-backend seam or pass a router key into the box. Genome → `profile`; backend → `backendType`; box env → `env` (no credentials).
`bench/src/sandbox-run.ts:92` (`WorkerBackendType:84`)

---

**`gate-cli.mts` (the harness CLI)** · `bench/src/gate-cli.mts` (run via `tsx`)
The instantiated diverse-vs-blind gate in one file: pick a benchmark via `BENCH=` (`ADAPTERS` lookup), the `K` strategies fix both arms' child count, run them through `runGate` over the Supervisor at equal compute (conserved pool), print the per-arm resolve Δ. Strategy selection is data; equal-k holds by construction.

```bash
BENCH=enterpriseops-gym EOPS_FIXTURES=1 N=20 K=4 TANGLE_API_KEY=… tsx bench/src/gate-cli.mts
# then the paired-bootstrap + BH verdict over the corpus:
tsx bench/src/corpus-report.mts corpus/<name>.jsonl
```
**Do NOT** write a new top-level run script that re-parses env and re-wires the gate — copy `gate-cli.mts`'s strategy/backend pattern or add your strategy to its `defaultStrategies` array.
`bench/src/gate-cli.mts` (default `BENCH=enterpriseops-gym`)

### 3.4 The Gated Optimizer — evolve the genome, certify wins

---

**`improvementDriver`** · `/improvement` · `@experimental`
The ONE reflective/agentic **code-surface** `ImprovementDriver` for agent-eval's improvement loop. Owns the candidate lifecycle (worktree create → generate → finalize/discard, × `populationSize`) and delegates the only varying thing (HOW a change is produced) to a pluggable `CandidateGenerator`. Once a worktree exists it is either finalized into a `CodeSurface{worktreeRef}` the loop measures on the holdout, or discarded — a throw never leaks the worktree+branch. Reflective vs agentic are two settings of its generator dial, NOT two drivers.

```ts
function improvementDriver(opts: ImprovementDriverOptions): ImprovementDriver<AnalystFinding>
// ImprovementDriverOptions = { worktree: WorktreeAdapter; generator: CandidateGenerator; baseRef?: string /* default 'main' */ }
// interface CandidateGenerator { kind: string;
//   generate(args: { worktreePath: string; report: unknown; findings: AnalystFinding[];
//     dataset?: LabeledScenarioStore; maxShots: number; signal: AbortSignal }): Promise<{ applied: boolean; summary: string }> }
```
```ts
import { improvementDriver, reflectiveGenerator } from '@tangle-network/agent-runtime/improvement'
import { gitWorktreeAdapter } from '@tangle-network/agent-eval/campaign'
const driver = improvementDriver({ worktree: gitWorktreeAdapter({ repoRoot }),
  generator: reflectiveGenerator({ improvementAdapter }), baseRef: 'main' })
```
**Do NOT** hand-roll a "skill optimizer"/"topology mutator"/"analyst driver" that opens its own branches and applies patches. Want a different change-production strategy → implement a `CandidateGenerator` (3 fields). Want PROMPT (string) evolution → use `gepaDriver`.
`src/improvement/improvement-driver.ts:59` (`CandidateGenerator:34`, `ImprovementDriverOptions:52`; barrel `src/improvement/index.ts:20`)

---

**`reflectiveGenerator`** · `/improvement` · `@experimental`
The cheap, no-sandbox `CandidateGenerator`: drafts surface edits via an `ImprovementAdapter` (one LLM patch per finding) and applies them as ONE coherent improvement into the candidate worktree (`git apply -p0` inside the fresh checkout so paths match). The `shots=1, sandbox=off` setting. `maxShots` is ignored (reflection is single-shot).

```ts
function reflectiveGenerator(opts: { improvementAdapter: ImprovementAdapter<SurfaceImprovementEdit> }): CandidateGenerator
```
**Do NOT** write a new "cheap prompt patcher" — `reflectiveGenerator` + `createSurfaceImprovementAdapter` already do finding → resolved-surface-path → LLM-drafted patch → git apply. You supply only `draftPatch`.
`src/improvement/reflective-generator.ts:24` (barrel `src/improvement/index.ts:22`)

---

**`agenticGenerator`** · `/improvement` · `@experimental`
The full-agentic `CandidateGenerator`: runs a real coding harness (`claude`/`codex`/`opencode`) inside the candidate worktree, letting the agent read the codebase + research report and edit in place. The `shots=N, sandbox=on` setting; `maxShots` is the DEPTH dial (re-prompt and retry while the worktree stays clean). The **worktree IS the signal** — it trusts the git diff, not stdout (`worktreeDirty` fails loud on a git error). Does NOT nest a second sandbox per candidate.

```ts
function agenticGenerator(opts?: AgenticGeneratorOptions): CandidateGenerator
// AgenticGeneratorOptions = { harness?: LocalHarness /* default 'claude' */; timeoutMs?; buildPrompt?; runHarness?; isDirty? }
```
**Do NOT** build a bespoke "spawn a coding agent in a temp dir and check if it changed anything" loop — customize phrasing via `buildPrompt`, inject the runner via `runHarness` for tests.
`src/improvement/agentic-generator.ts:43` (barrel `src/improvement/index.ts:16`)

---

**`createSurfaceImprovementAdapter`** · `/agent` · stable
The substrate-default `ImprovementAdapter` (finding → surface-file → LLM-drafted patch): parses each finding's subject, resolves it to a real path via `AgentSurfaces`, reads current content, asks YOUR `draftPatch` LLM callback for a unified diff, and applies it (`write`/`open-pr`/`none`) with base-SHA race detection. Fail-loud routing: unparseable subjects, undeclared-surface targets, missing targets, and schema-invalid drafts are all counted in `errors` with a reason — no silent skips.

```ts
function createSurfaceImprovementAdapter(opts: { surfaces: AgentSurfaces; repoRoot: string;
  draftPatch: (input: DraftPatchInput) => Promise<DraftPatchOutput>;
  mode?: 'write'|'open-pr'|'none'; baseBranch?; ghRepo?; allowCreateForKinds? }): ImprovementAdapter<SurfaceImprovementEdit>
```
**Do NOT** hand-roll a "profile-seam" that maps findings to files and writes patches — `AgentSurfaces` IS the declared genome map, `resolveSubjectPath` IS the resolver. You supply only `draftPatch`. `knowledge.*` subjects route to the KnowledgeAdapter, not here.
`src/agent/improvement-adapter.ts:129` (barrel `src/agent/index.ts:34`)

---

**`selfImprove`** · `@tangle-network/agent-eval/contract` · `@experimental`
The LAND-tier one-shot over `runImprovementLoop`: the cheapest call to run a real closed self-improvement — agent + scenarios + judge + `baselineSurface`, with smart defaults (`gepaDriver`, `defaultProductionGate@0.05`, 25% holdout, 3 gens × pop 2, in-memory storage). THE default entry for optimizing a PROMPT/config surface. Emits a durable `LoopProvenanceRecord`. `expectUsage` defaults to `'assert'` so a stub backend (zero tokens/cost) fails loud instead of scoring a clean 0.

```ts
function selfImprove<TScenario extends Scenario, TArtifact>(opts: SelfImproveOptions<TScenario, TArtifact>): Promise<SelfImproveResult<TScenario, TArtifact>>
// opts = { agent: (surface: MutableSurface, scenario, ctx: DispatchContext) => Promise<TArtifact>;
//   scenarios; judge: JudgeConfig; baselineSurface: MutableSurface;
//   budget?: { generations?; populationSize?; holdoutScenarios?; reps?; promoteTopK? };
//   driver?; gate?; llm?; analyzeGeneration?; autoOnPromote?: 'pr'|'none'; expectUsage? /* default 'assert' */ }
// SelfImproveResult = { baseline; winner; lift: number; diff: string; provenance;
//   gateDecision: 'ship'|'hold'|'need_more_work'|'model_ceiling'|'arch_ceiling'; ... }
```
```ts
const result = await selfImprove({
  agent: (surface, scenario, ctx) => runWithPrompt(surface as string, scenario, ctx),
  scenarios: train, judge, baselineSurface: baseDirective,
  budget: { generations: 2, populationSize: 3, holdoutScenarios: holdout }, autoOnPromote: 'none' })
console.log(`lift ${result.lift} (${result.gateDecision})`)
```
**Do NOT** build a bespoke optimize loop or a parallel skill-optimizer. For a code surface, pass your own `driver: improvementDriver(...)`. `agent` here is the same shape as `dispatchWithSurface`.
`node_modules/@tangle-network/agent-eval/dist/contract/index.d.ts:311` (`SelfImproveResult<TScenario,TArtifact>:234` — `lift:255`, `gateDecision:264`)

---

**`runImprovementLoop`** · `@tangle-network/agent-eval/contract` (also `/campaign`) · `@experimental`
The gated-promotion shell: drives candidate surfaces via the `ImprovementDriver`, re-scores the winner vs baseline on a HELD-OUT set, runs the release `Gate`, optionally opens a PR. Use it directly (vs `selfImprove`) when you need a code-surface driver or a custom gate. **THE slot the benchmark plugs into is `dispatchWithSurface`** — pass the current surface + scenario + ctx, return the artifact your judge scores. The judge's held-out verdict is write-only (`ProposeContext.judgeScores` is `never`-typed to make leaking it a compile error). Hard-refuses unsafe configs (`tracing:'off'` with a driver wired).

```ts
function runImprovementLoop<TScenario extends Scenario, TArtifact>(opts: RunImprovementLoopOptions): Promise<RunImprovementLoopResult>
// adds (over RunOptimizationOptions): baselineSurface: MutableSurface;
//   dispatchWithSurface: (surface, scenario, ctx) => Promise<TArtifact>;
//   driver: ImprovementDriver; populationSize; maxGenerations; holdoutScenarios: TScenario[];
//   gate: Gate<TArtifact,TScenario>; autoOnPromote: 'pr'|'none'; analyzeGeneration?; maxImprovementShots?; report?; findings?; promoteTopK?
```
**Do NOT** write your own propose→campaign→rank→re-score-on-holdout→gate→PR loop — this IS it.
`@tangle-network/agent-eval/contract` (re-exported via `dist/run-improvement-loop-5z_l5zDz.js`; type `RunImprovementLoopOptions`)

---

**`gepaDriver`** · `@tangle-network/agent-eval/contract` (also `/campaign`) · `@experimental`
A reflective `ImprovementDriver` for PROMPT-tier (string) surfaces: each generation reflects on the prior best's per-scenario scores + weakest dimensions, asks an LLM for targeted rewrites, and (when the Pareto frontier has >1 member) spends one slot merging complementary-strength parents. Implements GEPA (arXiv:2507.19457). The default driver inside `selfImprove`. `constraints` (`preserveSections`/`maxSentenceEdits`) keep structured docs from being clobbered (a "textual learning rate"). For CODE surfaces use `improvementDriver`.

```ts
function gepaDriver(opts: GepaDriverOptions): ImprovementDriver
// GepaDriverOptions = { llm: LlmClientOptions; model: string; target: string;
//   mutationPrimitives?: string[]; evidenceK?; temperature?; maxTokens?;
//   constraints?: { preserveSections?: string[]; maxSentenceEdits? }; combineParents?; combineMaxParents? }
```
**Do NOT** hand-roll a prompt-mutation reflection loop with its own Pareto bookkeeping — `selfImprove` constructs it from `llm` + `mutationPrimitives`; pass an explicit `driver` only to override.
`@tangle-network/agent-eval/contract` (re-exported via `dist/run-improvement-loop-5z_l5zDz.js`; type `GepaDriverOptions`)

---

**`defaultProductionGate` / `heldOutGate` / `composeGate`** · `@tangle-network/agent-eval/contract` (also `/campaign`) · `@experimental`
`defaultProductionGate` is the opinionated promotion `Gate`: composes held-out paired-bootstrap CI lift + anti-Goodhart per-dimension regression guard + red-team + reward-hacking + budget into one `Gate.decide`. Promotion ships ONLY when the held-out CI lower bound clears `deltaThreshold` (a significance test, not a point estimate), no critical dimension significantly regresses, and red-team/reward-hacking don't fire — decision ∈ `ship/hold/need_more_work/model_ceiling/arch_ceiling`. `heldOutGate` is the thin single-axis (delta-on-holdout) building block; compose à la carte with `composeGate`.

```ts
function defaultProductionGate<TArtifact, TScenario>(options: DefaultProductionGateOptions): Gate<TArtifact, TScenario>
// DefaultProductionGateOptions = { holdoutScenarios: Scenario[]; deltaThreshold?; confidence?; bootstrapResamples?;
//   bootstrapSeed?; minProductiveRuns?; criticalDimensions?: string[]; regressionTolerance?; budgetUsd?; redTeamBattery?; recentRuns?; blockOnRewardHackingGaming? }
function heldOutGate<TArtifact, TScenario>(options: HeldOutGateOptions): Gate<TArtifact, TScenario>
// HeldOutGateOptions = { scenarios: TScenario[]; deltaThreshold? }
```
**Do NOT** write your own "is the winner better" check comparing point estimates on the training set — that certifies false champions near coin-flip. For symmetric multi-objective promotion use `paretoSignificanceGate`.
`@tangle-network/agent-eval/contract` (re-exported via `dist/provenance-LnqRT0sS.js`; `composeGate`, `paretoSignificanceGate` alongside)

---

**`promotionGate`** · `/runtime` · stable
The runtime-local statistical promotion decision over a holdout `BenchmarkReport` (per-task cells for two named strategies): does the candidate beat the incumbent by a margin the per-task noise cannot fake? Wraps the substrate's seeded `heldoutSignificance` (paired bootstrap over per-task deltas) and supports `superiority` OR `non-inferiority` ('same quality, cheaper') modes. Deterministic, with a minimum-evidence floor (`minPairedTasks` default 6) and latency + cost-savings CIs. **Distinct from the agent-eval `Gate`** — this consumes a `BenchmarkReport`, not a `GateContext`.

```ts
function promotionGate(opts: PromotionGateOptions): PromotionVerdict
// PromotionGateOptions = { report: BenchmarkReport; incumbent: string; candidate: string;
//   mode?: 'superiority'|'non-inferiority'; scoreTolerance?; deltaThreshold?; minPairedTasks?;
//   statistic?: 'mean'|'median'; seed?; resamples? }
// PromotionVerdict = { promoted: boolean;
//   reason: 'identical-champion'|'few-tasks'|'no-margin'|'significant'|'non-inferior-and-cheaper'|'non-inferiority-unproven'|'not-cheaper';
//   mode; n; lift: {mean,median,low,high}; costSavings?; latency? }
```
**Do NOT** compare two strategies' mean scores directly or re-derive the bootstrap. Pick THIS over the agent-eval `Gate` when your evidence is a benchmark report.
`src/runtime/promotion-gate.ts:63` (`PromotionVerdict:39`; imports `heldoutSignificance` from `@tangle-network/agent-eval/campaign`; barrel `src/runtime/index.ts:182`)

---

**`runStrategyEvolution`** · `/runtime` · `@experimental`
The full gated genome-optimization loop: gen0 tournament → author-from-losses → gen1..N → frozen-holdout `promotionGate` → optional reproducer certification. Returns an `EvolutionReport` whose **only evidence-grade field is the gated `verdict`** — the per-generation `trajectory` is search telemetry, NOT proof. Implements the arXiv:2606.11045 reproducer certificate: compress an authored champion to a short summary, have a fresh author re-implement from the summary alone, re-score on the same holdout; a reproduction gap is an overfitting signal (recorded, never gate-blocking in v1). Checkpoint/resume re-pays at most one phase on a mid-run death.

```ts
function runStrategyEvolution(cfg: StrategyEvolutionConfig): Promise<EvolutionReport>
// cfg (key fields) = { environment; tasks: (offset,n)=>Promise<AgenticTask[]>; trainN; holdoutN;
//   worker: AgenticOptions; author: EvolutionAuthor; generations?=2; populationSize?=2;
//   objective?: 'score'|'cost'; champion?: ChampionPolicy; band?; reproducerCheck?: { summaryMaxWords?=64; tolerance?=0.05 };
//   checkpoint?: { path; resume? }; outDir }
// EvolutionReport = { verdict: PromotionVerdict; reproduction?: ReproductionCheck; trajectory /* telemetry, NOT evidence */ ... }
```
```ts
const report = await runStrategyEvolution({ environment, tasks, trainN: 20, holdoutN: 12, worker, author,
  generations: 2, outDir: '.loops/strategy/run1' })
if (report.verdict.promoted) promote(report.finalChampion)  // verdict, NOT trajectory, is the evidence
```
**Do NOT** hand-roll a gen0→author→gen1→holdout flywheel with hand-rolled champion selection + overfit check — this owns equal-budget tournaments, `pickChampion`/`selectChampion`, the band-screen, the reproducer certification, and checkpoint/resume.
`src/runtime/strategy-evolution.ts:364` (`StrategyEvolutionConfig:57`, `ReproductionCheck:188`, `EvolutionReport:213`; barrel `src/runtime/index.ts:277`)

### 3.5 Observability, Gates & Statistics

---

**`createWaterfallCollector`** · `/runtime` · stable
A `RuntimeHooks` sink that folds the lifecycle stream into one timed, billed span per spawn/settle — the run's full cost-and-time story. The SUM of spans IS the run cost; it's the single source the anytime metrics derive from (no second instrumentation path).

```ts
createWaterfallCollector(): WaterfallCollector  // { hooks: RuntimeHooks; report(): WaterfallReport; render(opts?): string; reset() }
// WaterfallSpan = { id; label; runId; parentId?; startMs; endMs?; status:'running'|'done'|'down'; usd; tokens:{input;output}; score? }
```
```ts
const wf = createWaterfallCollector()
await runBenchmark({ ...cfg, hooks: wf.hooks })
console.log(wf.render())
const report = anytimeReport(wf.report().spans, { targets: [0.5, 0.8, 1] })
```
**Do NOT** hand-roll a per-step cost/token tally by inspecting `LoopTraceEvent`s — attach this collector's `hooks` (spans are labeled `shot:N`/`analyst:N`, keyed by supervisor runId; a parallel tally drifts from billed totals).
`src/runtime/waterfall.ts:58` (`WaterfallSpan:11`, `WaterfallReport:25`; barrel `src/runtime/index.ts:369`)

---

**`anytimeReport` / `renderAnytimeTable`** · `/runtime` · stable
Time-to-satisfactory-output metrics (TTT, STT, ERT, AUC) derived entirely from waterfall spans — the COCO/BBOB anytime-optimization convention. Encodes the honest ERT (Σ ALL task wall-time including failures' full budgets ÷ #successes) and a SET of satisficing targets, so a strategy can't look fast by ignoring tasks it never solved.

```ts
anytimeReport(spans: WaterfallSpan[], opts?: { targets?: number[]; targetFor?: (taskId)=>number }): AnytimeReport
renderAnytimeTable(report): string
// AnytimeStrategySummary carries { medianTttMs; medianShotsToTarget; ertMs; erUsd; curveByShot; auc }
```
**Do NOT** compute your own time-to-target or a naive `total/successes` ERT (it hides budget spent on failures). Pass waterfall spans here.
`src/runtime/anytime.ts:73` (`AnytimeReport:55`, `renderAnytimeTable:164`; barrel `src/runtime/index.ts:41-42`)

---

**`RuntimeHooks` + `composeRuntimeHooks`** · root export (`@tangle-network/agent-runtime`) · `@experimental`
The ONE execution-scoped observer contract — `onEvent` (lifecycle: `agent.run/turn/tool_call/spawn/child/plan/decision`) + `onDecisionPoint` (semantic) + `onHookError`. It is the firewall between portable `AgentProfile`s and execution-time observation: hooks attach to the loop/harness, never to the profile. Fail-soft by construction — a throwing hook routes to `onHookError` and can NEVER become an agent-loop error.

```ts
interface RuntimeHooks { onEvent?(event: RuntimeHookEvent, ctx): void|Promise<void>;
  onDecisionPoint?(point, ctx): void|Promise<void>; onHookError?(error, ctx): void|Promise<void> }
// helpers: defineRuntimeHooks(h), composeRuntimeHooks(...h), notifyRuntimeHookEvent(h, event, ctx)
```
```ts
const hooks = composeRuntimeHooks(
  createWaterfallCollector().hooks,
  createTopologyView().hooks,
  { onEvent: (e) => metrics.record(e) })
await runBenchmark({ ...cfg, hooks })
```
**Do NOT** invent a second event-bus or a callback-prop zoo — there is ONE stream; `composeRuntimeHooks(...)` N observers into one sink.
`src/runtime-hooks.ts:80` (`RuntimeHookEvent:35`, `composeRuntimeHooks:102`; root exports `src/index.ts:188-196`)

---

**`createTopologyView` / `renderTopologyTree`** · `/topology` · `@experimental`
A live, pure projection of the recursive agent tree folded from the lifecycle stream — every spawn a node, every turn/tool_call/plan/decision advancing a step count — rendered as an aligned ASCII forest. The stream is the single source of truth: no I/O, no timers; same event order ⇒ same tree (so CLI render, TUI, and journal replay agree).

```ts
createTopologyView(): TopologyView  // { hooks: RuntimeHooks; ingest(event); nodes(); roots(); node(id); render(opts?): string }
renderTopologyTree({ roots, node }, opts?): string  // render without the live view (e.g. from replaySpawnTree)
// TopologyNode = { id; label; runtime?; parentId?; depth; status; steps; score?; reason?; childIds }
```
**Do NOT** rebuild a tree by tracking parent ids in your own `Map` or walking the `SpawnJournal` — attach `view.hooks`, or feed a journal replay to `renderTopologyTree`.
`src/topology/tree.ts:70` (`TopologyNode:24`, `renderTopologyTree:161`)

---

**`createOtelExporter` + `loopEventToOtelSpan` / `buildLoopOtelSpans`** · root export · stable
A dependency-free OTLP/HTTP span exporter for `LoopTraceEvent`s, plus converters: `loopEventToOtelSpan` (one flat span/event) and `buildLoopOtelSpans` (a nested, real-duration loop→round→iteration tree a GenAI trace viewer renders natively). Uses the current GenAI semconv (`provider.name` + `gen_ai.usage.input_tokens`/`output_tokens`, NOT the deprecated `gen_ai.system`/`prompt_tokens`). Returns `undefined` when no endpoint is configured (telemetry never blocks the run).

```ts
createOtelExporter(config?: { endpoint?; headers?; batchSize?=64; flushIntervalMs?=5000; resourceAttributes?; serviceName?='agent-runtime' }): OtelExporter | undefined
// reads OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS from env
buildLoopOtelSpans(events[], traceId, rootParentSpanId?): OtelSpan[]
```
```ts
const ex = createOtelExporter({ endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })
if (ex) { for (const s of buildLoopOtelSpans(loopEvents, traceId)) ex.exportSpan(s); await ex.flush() }
```
**Do NOT** write your own OTLP/JSON serializer or pull the OTEL SDK — this is the canonical seam (the Intelligence SDK builds on it). Don't emit the deprecated `gen_ai.system`/`prompt_tokens` keys.
`src/otel-export.ts:81` (`loopEventToOtelSpan:162`, `buildLoopOtelSpans:232`; root exports `src/index.ts:166-174`)

---

**`pairedLift` (bench) + `pairedBootstrap` / `heldoutSignificance` (substrate)** · `bench/src/stats.mts` / `@tangle-network/agent-eval`
The single paired-bootstrap-lift instrument every claim reports through. `pairedLift` (mean treatment−baseline over tasks, seeded 95% bootstrap CI + discordant count) at the bench layer; `pairedBootstrap`/`heldoutSignificance` in the substrate. mulberry32-seeded (B=10000) so every gate's CI is identical run-to-run; `heldoutSignificance` adds a `minProductiveRuns` floor + `fewRuns` flag so a too-small holdout can't masquerade as significant. `pairedLift` is the bench-local canonical source (there is no `pairedLift` export in agent-runtime's barrels). For BH/FDR control use `benjaminiHochberg(pValues, fdr?)` — a **substrate** (`@tangle-network/agent-eval`) export, consumed in `bench/src/corpus-report.mts`, not a `stats.mts` symbol.

```ts
pairedLift(baseline: number[], treatment: number[], bootstrapN=10000): { point; low; high; pairs; discordant }
heldoutSignificance(paired, opts?: { deltaThreshold?=0; minProductiveRuns?; statistic?; seed? }): { bootstrap; n; significant; fewRuns }
```
**Do NOT** write your own bootstrap loop or PRNG per gate (the duplication `bench/src/stats.mts` consolidated). Never report a point lift without `low/high/pairs`; for ship decisions use `promotionGate`, not a raw point compare.
`bench/src/stats.mts:66` (`pairedLift`; `PairedLift:52`); `heldoutSignificance` at `@tangle-network/agent-eval/campaign:687`; `benjaminiHochberg` imported in `bench/src/corpus-report.mts:40`

## 4. End-to-end ideal usage — compose the whole spine

Define a genome → run it driver⟷worker via the reactive substrate over a multi-turn `AgenticSurface` → measure with `runBenchmark` → optimize a prompt surface with `selfImprove` → certify with the gate. Real composition of the primitives above.

```ts
import {
  type AgenticSurface, type AgenticTask, sample, refine, defineStrategy,
  runAgentic, runBenchmark, createWaterfallCollector, anytimeReport, promotionGate,
} from '@tangle-network/agent-runtime/loops'
import { selfImprove } from '@tangle-network/agent-eval/contract'

// 1. GENOME — implement the domain seam ONCE (5 hooks). The genome's tools/mcp/knowledge
//    are only EXERCISED on a multi-turn surface like this — never on a single-shot bench.
const env: AgenticSurface = {
  name: 'commit0',
  async open(task)  { /* clone repo, start container */ return { id: 'box-1', surface: 'commit0' } },
  async tools()     { return [/* list_files, read_file, write_file (path-jailed off the tests), run_tests */] },
  async call(h, name, args) { /* mutate the artifact via the named tool */ return 'ok' },
  async score(task, h)      { /* parse pytest */ return { passes: 7, total: 10, errored: 0 } },
  async close(h)            { /* kill container, rm tmpdir */ },
}
const tasks: AgenticTask[] = rows.map(rowToTask)
const worker = { routerBaseUrl, routerKey, model: 'deepseek-v4-pro', innerTurns: 4 }

// 2. DRIVER⟷WORKER RUN — author a custom topology compactly; HARNESS-VERIFIED scoring.
const sampleThenRefine = defineStrategy('sampleThenRefine', async (ctx) => {
  const h = await ctx.surface.open(ctx.task)
  let best = await ctx.shot({ handle: h })                       // one breadth attempt
  for (let i = 1; i < ctx.budget && best && best.score < 1; i++) {
    const steer = await ctx.critique(best.messages)              // firewalled analyst (trajectory in, never scores)
    if (!steer) break
    best = await ctx.shot({ handle: h, messages: best.messages, steer })  // depth on the same artifact
  }
  await ctx.surface.close(h)
  return { score: best?.score ?? 0, resolved: (best?.score ?? 0) >= 1, completions: 0, progression: [], shots: 0 }
})

// Single run, fully observed (cost/time waterfall + anytime metrics from the same spans):
const wf = createWaterfallCollector()
const one = await runAgentic({ surface: env, task: tasks[0], ...worker, strategy: sampleThenRefine, budget: 4, hooks: wf.hooks })
console.log(one.score, one.usd, anytimeReport(wf.report().spans, { targets: [1] }))

// 3. BENCHMARK — compare strategies at EQUAL budget; get the Pareto frontier + paired-bootstrap lift for free.
const report = await runBenchmark({ environment: env, tasks, worker,
  strategies: [sample, refine, sampleThenRefine], budget: 3, concurrency: 3 })
console.log(report.refineVsSample, report.pareto)   // the headline + the non-dominated strategies

// 3b. CERTIFY a strategy swap on a FROZEN holdout report — never on the training composite.
const holdoutReport = await runBenchmark({ environment: env, tasks: holdoutTasks, worker,
  strategies: [refine, sampleThenRefine], budget: 3 })
const verdict = promotionGate({ report: holdoutReport, incumbent: 'refine', candidate: 'sampleThenRefine', minPairedTasks: 8 })
if (verdict.promoted) console.log('ship', verdict.lift); else console.log('hold', verdict.reason)

// 4. OPTIMIZE THE GENOME (prompt surface) in a gated loop — one call, gepaDriver + defaultProductionGate by default.
const opt = await selfImprove({
  agent: (surface, scenario, ctx) => runWithPrompt(surface as string, scenario, ctx), // surface = the system prompt being evolved
  scenarios: trainScenarios, judge, baselineSurface: baseSystemPrompt,
  budget: { generations: 2, populationSize: 3, holdoutScenarios: holdoutScenarios },
  autoOnPromote: 'none',
})
console.log(`prompt lift ${opt.lift} → ${opt.gateDecision}`)  // gateDecision ∈ ship|hold|need_more_work|model_ceiling|arch_ceiling
```

For the **multi-generation strategy flywheel** (gen0 → author-from-losses → genN → frozen-holdout → reproducer cert, with checkpoint/resume), replace steps 2–3b with one `runStrategyEvolution({ environment, tasks, trainN, holdoutN, worker, author, generations, outDir })` and read `report.verdict` (NOT `report.trajectory`) as the evidence. For a **sandbox coding rollout** measured against an external deterministic judge, use the bench-harness path instead: `runGate({ adapter: resolveAdapter('commit0'), strategies, n, … })` (the two arms each `fanout` k children through the keystone Supervisor at equal compute; the winning child's deployable verdict decides resolution).

## 5. The recursive atom — recursion · artifact · budget · analysts

The execution spine is one self-similar atom. Five axes, each grounded:

| Axis | What | Mechanism (file) |
|---|---|---|
| **Who (the driver)** | A `persona` is an agent IDENTITY; `runPersonified` personifies the **root/lead** — the agent that runs `act(task, scope)` and **spawns**. "A driver is just an `Agent` that spawns." | `definePersona`, `runPersonified` (personify/persona.ts) |
| **Topology** | the shape the driver runs | `loopUntil`/`fanout`/`panel`/`verify`/`widen`/`pipeline` (personify/combinators.ts) |
| **What it spawns** | worker · profile-variant · **sub-driver (recursion)** — a spawned child can itself be a personified driver running a sub-shape. Self-similar, bounded by `maxDepth`. | `spawnChild(spec)` / `childSpec(profile)` (personify/persona.ts:87); `maxDepth` ceiling |
| **Artifact** | **isolated** per child (own box/session) OR **collaborative shared** (commit-based, conflict-detected) | per-child session; `Workspace` = `gitWorkspace`/`jjWorkspace` (workspace.ts) |
| **Budget** | one conserved pool; each child reserves a recursive **sub-budget** carved from the parent → equal-k at every level by construction | `ShapeBudget.perChild` (personify/persona.ts:177; combinators.ts:67) |

**`loopUntil` is single-persona continuation** (it spawns `ctx.persona.root` each round — the driver continuing over one artifact, i.e. self-refinement). A two-party **distinct-driver ⟷ distinct-worker** conversation = a shape that spawns a *distinct* worker `AgentSpec` (the machinery supports it via `spawnChild(spec)`; `loopUntil` does not out of the box). `fanout(loopUntil)` = N parallel depth-loops, each its own artifact, one conserved budget split N ways.

**Collaborative artifact (`Workspace`):** N sub-loops each `materialize(dir)` the shared git/jj ref, work, and `commit(dir, msg)` → pull-rebase + push to one branch, returning `{ok, rev}` or `{ok:false, conflict}`. The collaboration unit is the commit; resume = re-materialize the head.

### Analysts — what's there, and the named gaps

`createScopeAnalyst` (personify/analyst.ts) is **one analyst per scope, post-round, single-lens**, firewalled (trace-only, charged to the conserved pool). Richer forms compose from existing machinery:

| Form | State | Mechanism |
|---|---|---|
| **Multiple analyst kinds** | ✅ | `AnalystRegistry` holds many kinds → findings + `apply` to surfaces (analyst-loop/) |
| **Streaming findings** | ✅ | `AnalystRegistryStreamingLike.runStream` (analyst-loop/run-analyst-loop.ts:146) |
| **Long-range** | ✅ | continuation (same artifact) · `analyzeGeneration` (cross-gen) · `FindingsStore`/`FindingsDiff`/`corpus` (cross-run) |
| **Panel-of-analysts steering ONE scope** | ⚠️ gap | composable via `panel()` + the registry, not first-class |
| **Online INTRA-turn steering** (react mid-shot, not post-round) | ⚠️ gap | the live lifecycle stream exists (`agent.spawn`/`settle`); no analyst consumes it to steer mid-shot |
| **Unified long-range analyst over the whole tree** | ⚠️ gap | the three long-range mechanisms aren't composed into one |

The three ⚠️ gaps are the natural completion of the atom — a **panel of analysts (correctness/cost/safety lenses) steering live, mid-turn, across the recursive tree** — and the substrate (registry, streaming, lifecycle events, sub-budgets) is all present; it just isn't composed into that shape yet.

## 6. The two substrates — when which

Both implement the same "recursive agent decision" atom; both run over the one `Executor` port; both share `defaultSelectWinner`. They are a deliberate pair — **do not invent a third.**

| | Reactive: `Supervisor`/`Scope` + personify combinators (the agent-driver) | Round-synchronous: `runLoop` kernel (the leaf) |
|---|---|---|
| Entry | `runPersonified`, `runAgentic`, `runBenchmark`, `createSupervisor`, `runGate` (bench) | `runLoop`; benches drive it via `openSandboxRun` + `sandboxAgentRun` |
| Shape of a turn | spawn-on-demand children on a conserved budget pool; react via `scope.next()` | a planned round of N tasks → one sandbox/iteration each → decide |
| Equal-k | by construction (atomic reservation pool, refund-on-settle) — `runGate` inherits it | `maxIterations` count + `maxConcurrency` cap; per-`Iteration` cost aggregation |
| Persistence | journal → content-addressed replay/resume of the exact `Settled` | fresh box per round (or `lineage` for session continuity/fork-fanout) |
| Best for | **NEW recursive/keystone work**: depth/breadth strategies, multi-agent shapes, nested drivers, anytime/cost analysis | **sandbox coding rollouts** driven the round-synchronous way against external benchmarks; what most benches drive today |
| Genome carrier | `Persona` (`definePersona`) → `AgentSpec.profile` | `AgentRunSpec.profile` (via `sandboxAgentRun`) |

**Rule:** prefer the reactive substrate for new recursive work (it's the newer canonical core); reach for `runLoop` when you're driving a sandbox round-synchronously against a benchmark with a deterministic judge. `inlineSandboxClient` adapts any non-box `Executor` into a `SandboxClient` for `runLoop` (`src/runtime/index.ts:77`), and `settledToIteration` bridges reactive `Settled`s into the kernel's `Iteration` for the shared selector — so the two substrates interoperate without forking selection or metering.

## 7. Note on the Intelligence SDK

`createIntelligenceClient` / `withTangleIntelligence` / `traceRun` / the `EffortPolicy` tiers (`off|eco|standard|thorough|max`) — the Observe + Mode-0 product layer with a provable OFF (passthrough) tier (`intelligenceUsd` clamped to 0 at `effort:'off'`, by construction) — are **MERGED to main**: `src/intelligence/index.ts` exports `withTangleIntelligence` + `createIntelligenceClient`, and `./intelligence` is a `package.json` export. `withTangleIntelligence(agent, { project, effort })` is the canonical drop-in observability + billing-boundary wrapper, built on `createOtelExporter` + `loopEventToOtelSpan` — import it from `@tangle-network/agent-runtime/intelligence`. **Do NOT** build your own trace-wrapper or effort/tier config object.
`src/intelligence/index.ts`, `src/intelligence/effort.ts` (on `main`; `./intelligence` package.json export)

---

**Accuracy note for the next agent:** every signature, export subpath, and `file:line` above was opened and confirmed against source at version 0.66.0 (agent-eval substrate `>=0.93.0`). Corrections folded in versus the prior draft: (1) the `runAgentic` **result** type `AgenticRunResult` is at `strategy.ts:509`, not `:969` (`:969` is `RunAgenticOptions`); the function is at `:985`. (2) `benjaminiHochberg` is a **substrate** (`@tangle-network/agent-eval`) export consumed in `bench/src/corpus-report.mts:40` — NOT a `bench/src/stats.mts` symbol. (3) `StrategyCtx` exposes `consult` (`strategy.ts:736`) + `listTools` (`:740`), never `rawCritique`. (4) `SelfImproveResult`/`selfImprove` are generic `<TScenario, TArtifact>`. (5) `./loops` and `./runtime` are the SAME barrel (`src/runtime/index.ts`) — `./loops` is the back-compat alias (`tsup.config.ts:11`). (6) The `ADAPTERS` key list is the real registry (`bench/src/adapters.ts:27`; `cad-design`/`cadbench`/`cadgenbench` are three distinct CAD keys, no fourth). (7) `selfImprove`/`runImprovementLoop`/`gepaDriver`/`defaultProductionGate`/`heldOutGate`/`composeGate`/`paretoSignificanceGate` are agent-eval substrate symbols re-exported through `@tangle-network/agent-eval/contract` (and `/campaign`), not local to this package. If a signature here ever disagrees with the source, the **code wins** — fix this doc in the same turn.