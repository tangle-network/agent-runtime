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

This skill carries **no API snippets**. The barrel MOVES (`./loops` is a
back-compat alias of `./runtime`), the agent-eval pin drifts, and signatures get
corrected in place. Freezing a snippet here guarantees rot. Instead, read, in
order, and re-verify against source:

1. **`docs/canonical-api.md`** — the source of truth: the §2 decision table
   ("I want to X → use Y → NOT Z"), §3 per-subsystem signatures (each cited
   `file:line`), §4 the end-to-end recipe, §5 the recursive atom, §6 the
   two-substrate map. Every signature there was read from source.
2. **`grep` the export barrel** — `grep -nE 'export (function|const|type)' src/runtime/index.ts`
   (and `src/agent/index.ts`, `src/improvement/index.ts`, `src/mcp/index.ts`,
   `src/intelligence/index.ts`) for the live names + subpaths. `./loops` and
   `./runtime` resolve to the SAME barrel (`package.json` maps both to
   `src/runtime/index.ts`).
3. **`bench/HARNESS.md`** — the experiment-harness map: commands, the
   `rollout → corpus → selector → CI → gate` flow, and the `ADAPTERS` registry
   (a harness-local export, `bench/src/adapters.ts`, not a package export).

**Code wins.** If a name, subpath, or signature here or in `docs/canonical-api.md`
disagrees with source, the **source is right** — fix the map in the *same turn*
(the anti-rediscovery law). Verify with Read/Edit, don't re-read to confirm.

## Decision table — by altitude (each row → ONE source, not a snippet)

Read the cited `docs/canonical-api.md` row before writing; it carries the live
signature + the exact "do NOT build".

| Altitude — I want to… | Use | Source |
|---|---|---|
| **Define a genome** (who the agent is + what it can do, ONE surface) | `AgentProfile` (runnable) / `AgentSurfaces` (the editable-coordinate map) — `/runtime`, `/agent` | canonical-api §3.2 |
| **Define the personified-run record** (model+prompt+tools+role+seams) | `definePersona(input)` — `/runtime` | canonical-api §3.1 |
| **Run a genome driver⟷worker, end-to-end** | `runPersonified({ persona, shape, task, budget })` — `/runtime` | canonical-api §3.1 |
| **Loop a worker over one evolving artifact, K rounds, stop-when-good** | `loopUntil(seed, spec)` as the `shape` — `/runtime` | canonical-api §3.1 |
| **Best-of-N / parallel-research at equal compute** | `fanout(items, opts)` — `/runtime` | canonical-api §3.1 |
| **Produce-then-gate / multi-judge quorum / fixed chain** | `verify` / `panel` / `pipeline` — `/runtime` | canonical-api §3.1 |
| **Run depth-vs-breadth (or a custom strategy) over a stateful tool domain** | `runAgentic({ surface, task, mode\|strategy, budget })` — `/loops` | canonical-api §3.3 |
| **Author a new topology/strategy compactly** | `defineStrategy(name, body)` w/ `ctx.shot()`+`ctx.critique()` — `/loops` | canonical-api §3.3 |
| **Add a stateful tool-using domain** | implement `AgenticSurface` (5 hooks) — `/loops` | canonical-api §3.3 |
| **Benchmark: compare strategies + significance + Pareto on a domain** | `runBenchmark({ environment, tasks, worker, strategies })` — `/loops` | canonical-api §3.3 |
| **Benchmark: add/run an external benchmark from the harness** | `ADAPTERS`/`resolveAdapter(key)` + a bench gate (`*-gate.mts`) over `openSandboxRun` + `sandboxAgentRun` (`bench/src/sandbox-run.ts`) | canonical-api §3.3 |
| **Sandbox coding rollout** (fresh box/round, or persistent+resume) | `runLoop(options)` / `openSandboxRun(client, opts, deliverable)` — `/runtime` | canonical-api §3.1 |
| **Optimize a CODE surface** in a gated loop | `improvementDriver({ worktree, generator })` — `/improvement` | canonical-api §3.4 |
| **Optimize a PROMPT/config surface** (one call) | `selfImprove({ agent, scenarios, judge, baselineSurface })` — `agent-eval/contract` | canonical-api §3.4 |
| **Gate: ship/hold a candidate** (campaign ctx) | `defaultProductionGate` / `heldOutGate` / `composeGate` — `agent-eval/contract` | canonical-api §3.4 |
| **Gate: ship/hold from a `BenchmarkReport`** (per-task cells) | `promotionGate({ report, incumbent, candidate })` — `/runtime` | canonical-api §3.4 |
| **Run the full multi-generation flywheel + certify** | `runStrategyEvolution(config)` — `/runtime` | canonical-api §3.4 |
| **Compose the prod sandbox profile** (eval/prod parity) | `composeProductionAgentProfile(base, opts)` — `/mcp` | canonical-api §3.2 |
| **Observe a run** (cost/time waterfall, live tree, OTLP) | `createWaterfallCollector` / `createTopologyView` / `createOtelExporter` via `composeRuntimeHooks(...)` — root | canonical-api §3.5 |
| **State any A/B claim** | `pairedLift` (bench) over `pairedBootstrap`/`heldoutSignificance` (substrate) | canonical-api §3.5 |
| **Observe/ship with billing-boundary** | `withTangleIntelligence(agent, { project, effort })` — `/intelligence` | canonical-api §7 (now live on main — verify) |

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
- `new Sandbox()` + acquire + stream + `box.fs.read` + delete **≈**
  `openSandboxRun` (persistent + resume) or `runLoop` (fresh box/round).
- `Promise.all` over N calls + manual argmax/merge **≈** `fanout` (bypassing the
  budget pool breaks equal-compute claims).
- a per-step cost/token tally over events **≈** `createWaterfallCollector` (the
  sum of spans IS the billed run cost; a parallel tally drifts).
- your own bootstrap loop / PRNG per gate **≈** `pairedLift` / `promotionGate`
  (seeded, identical run-to-run; never report a point lift without `low/high/pairs`).

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
Verify the live subpath against `src/intelligence/index.ts` (canonical-api §7's
"branch-only" note is stale — it landed on main).

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
