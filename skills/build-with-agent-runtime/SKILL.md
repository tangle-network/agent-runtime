---
name: build-with-agent-runtime
description: Use before hand-rolling a tool loop, driver, corpus, or optimizer wrapper. Create an agent genome, run it on a benchmark, optimize+gate it, observe/ship it with @tangle-network/agent-runtime. The genome→run→optimize→observe spine.
---

# build-with-agent-runtime

The one create→run→optimize→observe seam for `@tangle-network/agent-runtime`. A
**genome** (an `AgentProfile`/`AgentSurfaces` — systemPrompt + skills + tools +
mcp + knowledge + memory + rag as ONE combined surface) runs as a
**driver⟷worker** shape over a **benchmark**, gets **optimized by a gated loop**
that evolves the genome and certifies wins on a **frozen holdout**, and is
**observed** through the one lifecycle stream. The selector is never the judge;
observation attaches to the loop, never to the portable genome.

If you are about to write a `runConversation`, a "skill optimizer", a
"profile-seam", a depth-vs-breadth A/B harness, a bootstrap loop, or a
`new Sandbox(...)` + stream + read dance — **stop.** It exists, and a parallel
silently breaks a load-bearing invariant (equal-k, selector≠judge,
capture-integrity, or eval/prod parity).

## Load order — point at source, never freeze snippets

This skill carries **no API snippets**. The barrel MOVES (`./loops` is the
runtime barrel), the agent-eval pin drifts, and signatures get
corrected in place. Freezing a snippet here guarantees rot. Instead, read, in
order, and re-verify against source:

1. **`docs/canonical-api.md`** — the source of truth: the §2 decision table
   ("I want to X → use Y → NOT Z"), §3 per-subsystem signatures (each cited
   `file:line`), §4 the end-to-end recipe, §5 the recursive atom, §6 the
   two-substrate map. Every signature there was read from source.
2. **`grep` the export barrel** — `grep -nE 'export (function|const|type)' src/runtime/index.ts`
   (and `src/agent/index.ts`, `src/improvement/index.ts`, `src/mcp/index.ts`,
   `src/intelligence/index.ts`) for the live names + subpaths. `./loops` is the
   runtime barrel (`package.json` maps it to `src/runtime/index.ts`).
3. **`bench/HARNESS.md`** — the experiment-harness map: commands, the
   `rollout → corpus → selector → CI → gate` flow, and the `ADAPTERS` registry
   (a harness-local export, `bench/src/adapters.ts`, not a package export).

**Code wins.** If a name, subpath, or signature here or in `docs/canonical-api.md`
disagrees with source, the **source is right** — fix the map in the *same turn*
(the anti-rediscovery law). Verify with Read/Edit, don't re-read to confirm.

## Decision table — by altitude (each row → ONE source, not a snippet)

Read the cited `docs/canonical-api.md` row before writing; it carries the live
signature + the exact "do NOT build".

**The §1.5 law, inline:** an agent IS its full authored `AgentProfile`
(prompt+skills+tools+mcp+subagents+hooks); you change behavior by AUTHORING the
profile and letting the substrate materialize it into harness shapes —
self-verification, iteration, and audit are profile levers (hooks/skills/
subagents), never glue code.

`AgentProfile` is owned by `@tangle-network/agent-interface` (the `/loops`
barrel re-exports the sandbox alias as a one-stop import), which also owns
`HarnessType` + `ReasoningEffort` and a capability layer
(`harnessSupportsModel` / `reasoningEffortsFor`) — so harness/model/reasoning
compatibility is a queryable contract, not an assumption.

Harness is a RUN-layer coordinate, not part of the portable genome: it rides on
agent-runtime's `AgentSpec { profile, harness }`. To sweep it as an eval axis,
don't hand-declare a harness list — expand one base profile across
`CODING_HARNESSES` with `expandProfileAxes` (agent-eval), run with
`runProfileMatrix`, and pivot results by the stamped `AgentProfileCell`
(`groupRunsByAgentProfileCell`); `harnessSupportsModel` filters per harness,
and a vendor-locked harness that supports none of the requested models SNAPS
to its native default (`HARNESS_NATIVE_MODEL`) — never silently dropped.

| Altitude — I want to… | Use | Source |
|---|---|---|
| **Define a genome** (who the agent is + what it can do, ONE surface) | `AgentProfile` (runnable) / `AgentSurfaces` (the editable-coordinate map) — `/loops`, `/agent` | canonical-api §3.2 |
| **Define the personified-run record** (model+prompt+tools+role+seams) | `definePersona(input)` — `/loops` | canonical-api §3.1 |
| **Run a genome driver⟷worker, end-to-end** | `runPersonified({ persona, shape, task, budget })` — `/loops` | canonical-api §3.1 |
| **Loop a worker over one evolving artifact, K rounds, stop-when-good** | `loopUntil(seed, spec)` as the `shape` — `/loops` | canonical-api §3.1 |
| **Best-of-N / parallel-research at equal compute** | `fanout(items, opts)` — `/loops` | canonical-api §3.1 |
| **Produce-then-gate / multi-judge quorum / fixed chain** | `verify` / `panel` / `pipeline` — `/loops` | canonical-api §3.1 |
| **Run depth-vs-breadth (or a custom strategy) over a stateful tool domain** | `runAgentic({ surface, task, mode\|strategy, budget })` — `/loops` | canonical-api §3.3 |
| **Author a new topology/strategy compactly** | `defineStrategy(name, body)` w/ `ctx.shot()`+`ctx.critique()` — `/loops` | canonical-api §3.3 |
| **Spawn a coded loop as a first-class atom** (bounded/gated/steerable, spawned + steered like a worker — the 3rd shape beside leaf worker + driver child) | `defineLoop(name, { maxRounds, round | agents, check })` + `loopChild`, wired via `createInMemoryRunContext({ withLoop: true })` — `/loops` — multi-agent = `agents: [proposer, verifier]` (declarative chain, not a bespoke `runTwoAgent…` fn); NOT a hand-driver looping in the model's head; the loop-executor owns maxRounds + conserved budget + gate + steer-between-rounds | canonical-api decision table |
| **Add a stateful tool-using domain** | implement `AgenticSurface` (5 hooks) — `/loops` | canonical-api §3.3 |
| **Drive a team of agents over a graded `AgenticSurface` task** (workers settle on its check, driver self-improves from the failing tests) | `superviseSurface(profile, task, { surface, worker })` — `/loops` | canonical-api §2 |
| **Benchmark: compare strategies + significance + Pareto on a domain** | `runBenchmark({ environment, tasks, worker, strategies })` — `/loops` | canonical-api §3.3 |
| **Author a PRODUCT eval leaderboard** (cases + prompt + grader → ranked board, standard flags, fresh run-dir, export, `toBenchmarkAdapter()`) | `defineLeaderboard({ name, cases, prompt, score, axis?, backends?, flags?, setup?/teardown?, onCellEvents?, resolveModel?, export?, dispatch?, judges?, matrix? })` — `/loops` — NOT a hand-assembled flag-parsing + `runProfileMatrix` frame; `runProfileMatrix` is the escape floor, the level-2 `dispatch` override is how in-process products plug in | `src/runtime/define-leaderboard.ts` (verify vs source) |
| **Resolve a harness-in-box backend** (box / local cli-bridge / router leaf, one `SandboxClient` shape) | `resolveSandboxClient({ backend: 'sandbox' \| 'bridge' \| 'router' })` — `/loops` — NOT a per-product backend factory or a hand-faked box (`inlineSandboxClient` / the bridge executor already exist) | `src/runtime/resolve-sandbox-client.ts` |
| **Resolve an in-process chat backend** (the one `--backend` branch for `runChatThroughRuntime` / `runAgentTaskStream`) | `resolveAgentBackend({ kind: 'router' \| 'tcloud' \| 'cli-bridge' \| 'sandbox' })` — root `.` | `src/resolve-agent-backend.ts` |
| **Run ONE agent turn as one normalized event stream** (box, executor, or chat backend; guaranteed terminal result+usage) | `streamAgentTurn(backend, prompt, { signal, timeoutMs })` + `collectAgentTurn(stream)` — `/loops` | canonical-api §2 |
| **Benchmark report: multi-profile × multi-axis leaderboard** (ranked board + score matrix + SVG/HTML charts, any `RunRecord[]`) | `leaderboard(records)` + `renderLeaderboardMarkdown` / `renderLeaderboardSvg` / `renderLeaderboardHtml` — `/loops` | canonical-api §2 |
| **Meter one `openSandboxRun` cell's token/cost usage** | `sumSandboxUsage(events)` — `/loops` | canonical-api §2 |
| **Sweep harness × model as an eval axis** (turn one base profile into the full harness × model set) | `expandProfileAxes({ base, harnesses, models })` over `CODING_HARNESSES` → `runProfileMatrix(...)`, pivot with `groupRunsByAgentProfileCell` — `agent-eval` root — NOT a hand-declared `HARNESSES` list | agent-eval root (verify vs source) |
| **Benchmark: add/run an external benchmark from the harness** | `ADAPTERS`/`resolveAdapter(key)` + a bench gate (`*-gate.mts`) over `openSandboxRun` + `sandboxAgentRun` (`bench/src/sandbox-run.ts`) | canonical-api §3.3 |
| **Spawn N coding agents on isolated git worktrees, keep the one whose patch passes checks** | `worktreeFanout` + `createWorktreeCliExecutor` + `gateOnDeliverable(DeliverableSpec)` over a raw `WorktreePatchArtifact`, winner via `selectValidWinner` — `/loops` — NOT a hand-rolled spawn-loop / "coder" role | canonical-api §3.1 / §5 |
| **Sandbox coding rollout** (fresh box/round, or persistent+resume) | `runLoop(options)` / `openSandboxRun(client, opts, deliverable)` — `/loops` | canonical-api §3.1 |
| **Optimize a CODE surface** in a gated loop | `improvementDriver({ worktree, generator })` — root `.` | canonical-api §3.4 |
| **Optimize a PROMPT/config surface** (one call) | `selfImprove({ agent, scenarios, judge, baselineSurface })` — `agent-eval/contract` | canonical-api §3.4 |
| **Gate: ship/hold a candidate** (campaign ctx) | `defaultProductionGate` / `heldOutGate` / `composeGate` — `agent-eval/contract` | canonical-api §3.4 |
| **Gate: ship/hold from a `BenchmarkReport`** (per-task cells) | `promotionGate({ report, incumbent, candidate })` — `/loops` | canonical-api §3.4 |
| **Run the full multi-generation flywheel + certify** | `runStrategyEvolution(config)` — `/loops` | canonical-api §3.4 |
| **Observe a run** (cost/time waterfall, OTLP) | `createWaterfallCollector()` — `/loops`; `createOtelExporter` attached via `composeRuntimeHooks(...)` — root `.` | canonical-api §2 |
| **State any A/B claim** | `pairedLift` (bench) over `pairedBootstrap`/`heldoutSignificance` (substrate) | canonical-api §3.5 |
| **Observe/ship with billing-boundary** | `withTangleIntelligence(agent, { project, effort })` — `/intelligence` | canonical-api §2 |
| **Pull the certified profile from the Intelligence plane** (pull-by-default delivery: fold the gate-certified prompt onto the base surface) | `pullCertified` / `withCertifiedDelivery` / `composeCertifiedPrompt` — `/intelligence` | `src/intelligence/delivery.ts` |

## Do-NOT-reinvent — the traps this skill exists to stop

Each of these gets hand-rolled every session; the canonical primitive already
holds the load-bearing invariant the parallel breaks:

- `runConversation` / persona-runner / `while(!done)` steering loop **≈**
  `loopUntil` + `runPersonified` (threads executor seams; equal-k; selector≠judge
  firewall; journal/replay — a parallel runner silently fails to wire the seams).
- "skill optimizer" / "topology mutator" that opens branches + applies patches
  **≈** `improvementDriver` (code surface) or `selfImprove`/`gepaDriver` (prompt
  surface) — both gated on a frozen holdout.
- "profile-seam" / agent-config wrapper carrying model+prompt+tools+role **≈**
  `AgentProfile` (it IS that bundle) + `definePersona` (the run record);
  `sandboxAgentRun({ profile })` is the box seam — never pass a router key into
  the box.
- "drive N coding agents in worktrees + pick the passing patch" / a "coder" role
  **≈** `worktreeFanout` + `gateOnDeliverable` (each on its own worktree-CLI leaf,
  settled ⟺ delivered, winner via `selectValidWinner` — a hand-rolled spawn-loop
  skips the deliverable gate and the valid-only selection).
- `new Sandbox()` + acquire + stream + `box.fs.read` + delete **≈**
  `openSandboxRun` (persistent + resume) or `runLoop` (fresh box/round).
- `Promise.all` over N calls + manual argmax/merge **≈** `fanout` (bypassing the
  budget pool breaks equal-compute claims).
- a per-step cost/token tally over events **≈** `createWaterfallCollector` (the
  sum of spans IS the billed run cost; a parallel tally drifts).
- your own bootstrap loop / PRNG per gate **≈** `pairedLift` / `promotionGate`
  (seeded, identical run-to-run; never report a point lift without `low/high/pairs`).
- a per-product `HARNESSES` / `HarnessBackend` list + a metadata-harness reader
  **≈** `CODING_HARNESSES` + `expandProfileAxes` (the one canonical harness list;
  vendor-locked harnesses SNAP to their native model via `HARNESS_NATIVE_MODEL`,
  never dropped) and the
  `AgentProfileCell` stamped by `runProfileMatrix`, pivoted via
  `groupRunsByAgentProfileCell` — never bake the harness into the model id so the
  same model can run under multiple harnesses.
- a per-product leaderboard CLI (flag parsing + run-dir management + axis
  expansion + a `runProfileMatrix` call + export/markdown) **≈**
  `defineLeaderboard` (0.84+; it owns that whole frame — FRESH default run-dir,
  standard `--backend`/`--harnesses`/`--models`/`--cases`/`--shots`/`--reps`
  flags, `toBenchmarkAdapter()`; the product writes ~150-250 domain lines).
- a backend factory / `if (backend === 'router') ... else ...` branch or a
  hand-faked box around a non-box executor **≈** `resolveSandboxClient`
  (harness-in-box: `'sandbox' | 'bridge' | 'router'`) or `resolveAgentBackend`
  (in-process: `'router' | 'tcloud' | 'cli-bridge' | 'sandbox'`) — grep the
  substrate first; `inlineSandboxClient` and the bridge executor exist.
- a per-provider stream→event mapper for a single agent turn **≈**
  `streamAgentTurn` + `collectAgentTurn` (0.85+; one `RuntimeStreamEvent`
  contract over box / executor / chat, guaranteed terminal result+usage).
- a supervisor `act` with a `for (round…)` loop that spawns + checks + continues
  in the model's reasoning **≈** `defineLoop` + `loopChild` (the loop-executor
  enforces the round ceiling, the conserved pool, the completion gate, and
  steer-between-rounds; a hand-driver loop enforces none of them).

## End-to-end recipe

`docs/canonical-api.md` §4 is the real composition — copy it from there, don't
re-derive: **define a genome → run driver⟷worker via the reactive substrate over
a multi-turn `AgenticSurface` → measure with `runBenchmark` → optimize a prompt
surface with `selfImprove` → certify on a frozen holdout with the gate.** For the
multi-generation flywheel, replace the measure/certify steps with one
`runStrategyEvolution(...)` and read `report.verdict` (NOT `report.trajectory`)
as the evidence. For a sandbox coding rollout judged by an external deterministic
checker, use the bench-gate path: `resolveAdapter(...)` to pick the benchmark,
then `openSandboxRun(client, { agentRun: sandboxAgentRun({ profile }), ... },
deliverable)` per task, A/B-ing a blind arm against an `llmAnalyst`-steered arm
at equal compute (both helpers live in `bench/src/sandbox-run.ts`; the blind arm
is the mandatory equal-compute control). See `bench/src/commit0-gate.mts` /
`gate.ts` for the live shape.

## Two substrates — pick one, don't invent a third

Both implement the same recursive-decision atom over the one `Executor` port and
share `defaultSelectWinner`. **Reactive** (`Supervisor`/`Scope` + personify
combinators: `runPersonified`/`runAgentic`/`runBenchmark`) — prefer for NEW
recursive work; equal-k by construction. **Round-synchronous** (`runLoop` driven
by a caller-supplied `Driver`, plus the bench gates over `openSandboxRun`) —
sandbox coding rollouts against external benchmarks. The full when-which map is
`docs/canonical-api.md` §6.

## Observe / ship with the Intelligence SDK

One line wraps any agent with trace + billing boundary:
`withTangleIntelligence(agent, { project, effort })`, `effort ∈
off|eco|standard|thorough|max` (`'off'` is the provable passthrough floor —
intelligence spend clamped to 0). It builds on `createOtelExporter` +
`loopEventToOtelSpan` — don't hand-roll a trace-wrapper or effort/tier config.
Verify the live subpath against `src/intelligence/index.ts`.

Two operational facts every consumer must know:

- **Export is a silent no-op without an endpoint.** The export leg only ships
  when `INTELLIGENCE_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_ENDPOINT`) is set —
  e.g. `https://intelligence.tangle.tools/v1/otlp`; absent, spans are dropped
  best-effort with no error. The client's `doctor().exportConfigured` is the
  check that export will actually ship.
- **Delivery pulls the certified profile from the plane.** `pullCertified` /
  `withCertifiedDelivery` hit
  `GET {TANGLE_INTELLIGENCE_URL|https://intelligence.tangle.tools}/v1/profiles/:target/composed`
  with `Bearer TANGLE_API_KEY`; `withCertifiedDelivery` folds the certified
  prompt onto the base surface, refreshes at most every 5 minutes, and is
  fail-closed — a failed pull runs the agent on its base surface.

## Final check

- Picked a primitive from the decision table, not a hand-rolled parallel?
- Genome is ONE `AgentProfile`/`AgentSurfaces` surface, not split skill/tool/prompt knobs?
- Equal compute preserved (budget pool, or `arms[0]` control) — no `Promise.all` zoo?
- Selector ≠ judge: no judge score feeding a driver/another judge; holdout score write-only?
- Any win certified on a FROZEN holdout via a gate, never on the training composite?
- Map fixed in the same turn if source disagreed with `docs/canonical-api.md`?

See `_common.md` for shared conventions (frontmatter, fail-loud, no AI attribution).

Next: build the genome/loop/optimizer against `docs/canonical-api.md` §3–§4; if a
strategy beats incumbent on the holdout gate, `/ship` it.
