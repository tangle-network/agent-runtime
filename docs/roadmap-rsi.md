# RSI Surface — Implementation & Cleanup Roadmap

Companion to [architecture.md](./architecture.md) (the spine) and [architecture-interpretations.md](./architecture-interpretations.md) (the coherence verdict). This is the operational, file-grounded build-and-cleanup sequence that turns the spine's §9 build order into concrete steps — from *scaffold built, intelligence designed* to a measured, world-class surface for all four framings (test-time-compute search, active learning / experimental design, program synthesis, two-timescale RSI). Every step cites the seam (`file:line`) and an exit gate. Grounded against `origin/main`.

## The principle: make it measurable before you build it

Building the recursive-driver layer is gated on **Gate A** (the inner GO/NO-GO) from [architecture-interpretations.md §5](./architecture-interpretations.md#5-the-decision-gate):

> Build the adaptive driver only if, at **equal worker-compute** (Σ rollouts × turns — `k` counts ROLLOUTS, each of which may be a full multi-turn/stateful trajectory), a **trace+findings-fed** driver scored by a **sound non-oracle selector** beats **random@k** selected by that *same* selector — significantly, and surviving selector test-retest.

**Gate A is NOT the project-success criterion.** Project success is **Gate B** — the cross-run flywheel slope on a **multi-objective** (correct · fast · secure · cheap, each its own deployable checker), verifier-graded score ([learning-flywheel.md](./learning-flywheel.md), [architecture.md §0.5](./architecture.md)). Gate A only decides whether the *within-run adaptive driver* is worth building; a failed Gate A deletes within-run steering, never the corpus+controller product. **Note the asymmetry in this roadmap:** Phases 0–4 below are all instrumented for Gate A (within-run, single-objective correctness) — that is the cheap, buildable diagnostic. Gate B (the across-run policy curve on a multi-objective task stream) is the actual success criterion and is **not yet instrumented**; standing it up is the durable next step, not a replay over the existing single-objective corpus.

So the phases are ordered to make each step measurable on an honest baseline *before* the next is built. Build order: **honest baseline → the cheap win (selector) → wire the intelligence (analyses) → grow the language (ISA) → the use case (acquisition)**. The cleanup and doc tracks run in parallel because they are additive-safe.

> **Status (updated POWER-16).** The canonical "drive an agent" path is the **agent-driver**:
> an `AgentProfile` driving another via `createCoordinationTools`
> (`src/mcp/tools/coordination.ts`) over the `Scope`/`Supervisor`
> (`src/runtime/supervise/`), plus `runAgentic`/`defineStrategy`/`runPersonified`
> (`strategy.ts`/`persona.ts`); the `runAgentRounds` kernel (`src/runtime/run-loop.ts`) is
> one leaf backend. **Gate A's +16.4pp anchor was
> RETRACTED to a TIE at power.** On the canonical `Scope`/`Supervisor` + `observe()` +
> `defineStrategy` loop the n=16 EOPS-itsm signal (depth +16.4pp CI [+5.3, +29.8], 6W/0L,
> deepseek-v4-pro; +8.3pp disjoint) did **not** replicate: at n=48 depth−breadth = +4.7pp
> CI [−1.9, +11.4] (a tie; +4.1pp at n=72) — an underpowered overestimate, at most a small
> effect. The program has pivoted off this anchor (`.evolve/current.json`). It remains
> domain-bounded: negative on stateless retrieval (FinSearchComp),
> null-to-negative on stateless codegen (HumanEval; exec-grounded repair −17.1pp). The
> live optimization portfolio is
> [docs/research/optimization-space.md](./research/optimization-space.md). **Gate B
> (across-run, multi-objective) remains the success criterion and remains
> uninstrumented**; its minimal single-objective form is the gen0 → `authorStrategy`
> (`src/runtime/strategy-author.ts`) → gen1 → rotating disjoint holdout under the seeded
> `promotionGate` (`src/runtime/promotion-gate.ts`) flow — standing that runner up over those
> primitives is the open work. Per-phase status is in the phase map.

---

## Phase map

| Phase | Goal | Depends on | Exit gate | Risk | Status (2026-06-10) |
|---|---|---|---|---|---|
| **0** | Honest baseline + preconditions (no kernel change) | — | Every runner reports `random@k` at equal k; corpus has a measurable discordant-pair rate | low | **done** — `runPool` landed (`bench/src/run-pool.ts`); the corpus + `corpus-report.mts` BH-FDR path is the `random@k`-control measurement surface |
| **1** | Deployable non-oracle selector | 0 | `selector@k > random@k` significant (paired bootstrap + BH), low test-retest flip rate, on a frozen held-out split | low–med | **built + measured** — verifier-grounded selector positive on HumanEval (+12pp verifier−sc CI [+4,+22] / +18pp random−blind, BH-sig, n=50 k=4); answer-agreement negative (finsearch −8.2pp, aec −9.4pp) |
| **2** | Wire `analyses → driver` (the missing edge) | 0, 1 | **Gate A** (inner GO/NO-GO for the recursive-driver layer): `refine@k-with-findings > random@k` at equal compute under the Phase-1 selector, significant, survives test-retest — NOT flywheel success (Gate B) | med | the diagnosis→steer edge lives on the agent-driver (`observe()` → `createCoordinationTools`); Gate A itself **ran on the Supervisor substrate, then RETRACTED to a tie at power** (header note) |
| **3** | Grow the ISA (`select` then `seq`) | 2 | A strategy expressing `select`/`seq` beats a flat one on the same harness | med (3a) / high (3b) | **superseded** — `defineStrategy` (`src/runtime/strategy.ts`) is the richer program space: a strategy is ordinary code with arbitrary sequencing and branching |
| **4** | Acquisition adapter (research use case) | 0, 1 (parallel to 2) | Active acquisition beats random acquisition on the deployable coverage-vs-budget curve under a *structural* gap signal | med–high | open |

---

## Phase 0 — Honest baseline + preconditions

**No kernel change.** Removes the confound that makes every steering number untrustworthy today.

- **Land `runPool`** — **done**: `bench/src/run-pool.ts` exists and the batch runners route through it. Cleanup-track item 1.
- **Close the compute-vs-steering confound.** The `random@k` compute-matched control is supplied by whatever runner drives the agent-driver over the corpus (the blind arm is the mandatory equal-compute control on the same run); confirm every runner reports it at equal k.
- **PRECONDITION CHECK (blocking).** Verify there is `k>1` answer **diversity** in the corpus. A near-deterministic model makes `oracle@k ≈ pass@1` (identical shots) — a no-oracle selector then has *nothing to choose among* and Phase 1 is unmeasurable (0 discordant pairs). Generate the corpus with `MODELS` heterogeneity or temperature > 0 and confirm a non-zero discordant-pair rate before spending on Phase 1.

**Exit gate:** all three runners report `random@k` at equal k; the corpus exhibits a measurable discordant-pair rate.

## Phase 1 — Deployable non-oracle selector

At audit time the selector was **faked with the judge**: `defaultSelectWinner` (`src/runtime/run-loop.ts:983`) and `branchPoint` (`:797`) rank by `verdict.score`, and in the bench the validator *was* the judge — so every `random@k`/`refine@k`/`oracle@k` number was judge-selected (an oracle upper bound). This phase builds the deployable ranker — the piece that actually makes best-of-N pay.

- **Build `rank(attempts: AttemptRecord[]) -> index`** — a pure function over *stored outputs/traces only* (self-consistency / answer-agreement / a PRM). Never reads `verdict`. (Open: evaluate `@tangle-network/agent-eval`'s `/prm` subpath before hand-rolling agreement scoring.)
- **Inject** via `RunAgentRoundsOptions.selectWinner` (`src/runtime/run-loop.ts:104`, honored at `:881`). No kernel surgery. Note: `branchPoint` (`:797`) also ranks edge lineage on `verdict.score` — make it selector-aware for a fully oracle-free deployment.
- **Measure OFFLINE first** via `corpus-replay.mts`'s `scoreCandidateOffline` seam: per instance, pick one of the k stored outputs, then judge only the pick (zero new rollouts; deterministic judges free, LLM judge = 1 call/instance). Report `selector@k − random@k` (PRIMARY family) and `selector@k − oracle@k` (exploratory headroom-gap) as `TestEntry` rows in `corpus-report.mts` (reuse `pairedLift` + `benjaminiHochberg`). Compute the **test-retest** flip rate from the same corpus (run the picker twice; report flip fraction + paired-bootstrap CI). Power with `requiredSampleSize`/`pairedMde` from `agent-eval/statistics`.
- **Ship gate** via `heldoutSignificance(pairHoldout(...))` (packaged as `promotionGate`, `src/runtime/promotion-gate.ts`) or `compareDrivers`, on a frozen held-out split disjoint from the threshold-tuning split.

**Exit gate:** `selector@k > random@k` (paired bootstrap, BH-FDR) with a low test-retest flip rate, on a frozen held-out split.

**Status: built + measured.** The selector lives at `bench/src/selector.ts`, replayed offline via `corpus-replay.mts --selector`. A **verifier-grounded** selector is positive on a deployable-checker domain — HumanEval, n=50, k=4: verifier-pick captures the full oracle ceiling (94% = oracle 94%); verifier − self-consistency **+12.0pp CI [+4, +22]**, BH-significant; random@k − blind +18.0pp CI [+8, +30]. **Answer-agreement selectors lose** (finsearch −8.2pp n=51; aec-diverse −9.4pp n=16): the selector needs a runnable checker, not answer-vote. The packaged ship gate is `promotionGate` (`src/runtime/promotion-gate.ts`) — a seeded paired bootstrap over agent-eval's `heldoutSignificance` with an evidence floor of 6 paired tasks and a CI lower bound that must clear the threshold.

## Phase 2 — Wire `analyses → driver`

The load-bearing edge. **Status: lives on the agent-driver.** The diagnosis→decision edge runs on the **agent-driver**: a parent `AgentProfile` consumes `observe()` findings (`AnalystFinding`, the substrate type from `@tangle-network/agent-eval` — **never redefined**, the layering rule) and steers its child via `createCoordinationTools` (`src/mcp/tools/coordination.ts`) over the `Scope`/`Supervisor`. The `runAgentRounds` kernel (`src/runtime/run-loop.ts`) stays analyst-free. **No bench feeds the findings-fed treatment arm against the `random@k` control under the Phase-1 selector live yet** — that is the remaining work on this substrate.

**Exit gate — Gate A (inner GO/NO-GO).** `refine@k-with-findings > random@k` at equal compute under the Phase-1 selector, statistically significant, surviving selector test-retest. **If it fails:** stop building the *within-run recursive-driver layer* — ship Phases 0–1 + Phase 4 (agentic RAG with a verifier) and delete the *steering machinery*. The recursive-driver layer is unjustified overhead unless this clears. **This is scoped to within-run steering only — it is NOT the flywheel-success criterion (Gate B, [learning-flywheel.md](./learning-flywheel.md)); a failed Gate A never deletes the corpus+controller product.**

**Gate A status: TIE at power (POWER-16), on the `Scope`/`Supervisor` substrate** — the n=16 "+16.4pp cleared" signal (depth-steered continuation, analyst-fed via `observe()`, vs blind breadth at equal compute under keep-best scoring) collapsed to depth−breadth +4.7pp CI [−1.9, +11.4] at n=48 (header note). At most a small effect, not a cleared keystone; the program pivoted off it.

## Phase 3 — Grow the ISA (program synthesis)

**Status: superseded by `defineStrategy`.**

The program-synthesis path is `defineStrategy` (`src/runtime/strategy.ts`): a strategy is ordinary code composing `shot()`/`critique()` with arbitrary sequencing, branching, and state, and `authorStrategy` (`src/runtime/strategy-author.ts`) makes it agent-authorable. `select`/`seq` are expressed directly in strategy code rather than as an emittable move enum. Program-space work happens there.

**Exit gate (carried by the strategy substrate):** an authored strategy (`authorStrategy`, `src/runtime/strategy-author.ts`) beats the incumbent on a frozen holdout under `promotionGate` (`src/runtime/promotion-gate.ts`); standing that runner up over those primitives is the open work.

## Phase 4 — Acquisition adapter (the research use case)

Runs in **parallel** to Phases 1–2 (bench-only, no kernel code). This is the knowledge-acquisition loop framed as active learning / experimental design over sources.

- **Build a `RefineLoopSpec<WikiState, AcquisitionCtx>`** over `runRefineLoop` (`refine-loop.ts:44-63`): `setup` = open/create the vault; `prompt(round, history)` = the maintainer directive folding prior pages + open contradictions; `runShot` variants = (i) an `llm-wiki` maintainer+critic (ingest → propose page edits → lint contradictions/staleness/orphans) and (ii) a `bad`-CLI browser source-fetcher reusing `bench/src/browser/adapters/bad.ts` for web data/video/images; `judge` = the critic's lint verdict; `teardown` = flush the vault.
- **Propose through `runAnalystLoop`, measure through `runKnowledgeImprovementJob`, and write only through `createKnowledgeImprovementActivationExecutor`.** Analysis never mutates the live knowledge tree.
- **The gap signal must be STRUCTURAL** — graph topology, citation/embedding density, redundancy-discounted coverage — **not an LLM vibe.** A miscalibrated acquisition function underperforms random sampling ([interpretations §3.2](./architecture-interpretations.md#32-active-learning--experimental-design)); the structural signal is what makes this active learning rather than coverage-greedy ingestion.
- **No mocks** — real vault, real `bad` runs (repo doctrine).
- Source-selection is authored as a `defineStrategy` program (`src/runtime/strategy.ts`) driven over the `Scope`/`Supervisor`.

**Exit gate:** active acquisition beats random acquisition on the deployable coverage-vs-budget curve (held-out, write-only downstream judge) under the structural gap signal.

---

## Cleanup track (parallel, additive-safe)

| # | Item | Seam | Action | Risk |
|---|---|---|---|---|
| 1 | Hand-rolled pools | `bench/src/run-pool.ts` | **landed** — the batch runners route through `runPool` | low |
| 2 | Decentralized directive | `worker-browser.ts:44` | Move `DEFAULT_MIND2WEB_DIRECTIVE` into `directives.ts` (the doctrine that file states) | low |
| 3 | `RunRecord` name collision | `bench/src/corpus.ts:22,38` | Rename bench's `RunRecord`/`AttemptRecord` → `FlywheelRunRecord`/`-Attempt` (collides with substrate `RunRecord`) | low |
| 4 | Refine/fanout topology | — | **resolved** — refine/fanout are personify combinators or `defineStrategy` programs over the `Scope`/`Supervisor` | — |
| 5 | `terminal-compare` forked refine loop | `terminal-compare.ts:418-457` | Optional: migrate onto `runRefineLoop` (keep tb-specific `captureRunRecord`) after #1 lands | med |

No benchmark adapter is removed — planned stubs (e.g. AppWorld) are kept.

## Doc consolidation track

| Doc | Verdict | Action | Status |
|---|---|---|---|
| `README-full.md` | superseded | DELETE (frozen pre-cut README; 0 commits since the 551→138 cut) | **this PR** |
| `docs/README.md` | missing | CREATE the index (two tracks; architecture.md wins on conflict) | **this PR** |
| `architecture-interpretations.md` | new | ADD the 5-lens coherence doc + diagrams | **this PR** |
| `roadmap-rsi.md` | new | ADD this roadmap | **this PR** |
| `architecture.md` | canonical | ADD a "Built vs Designed" callout + cross-refs | **this PR** |
| `agent-spine.md` | dropped | DELETE — the recursive-atom framing supersedes the `ExecutionEnvironment` seam (confirmed absent from `src/`); not a build target | **this PR** |
| `agent-bus-protocol.md` | needs-update | Fix the 429-vs-413 contradiction (`:51,:56`), correct the subpath list vs `package.json` exports, bump the 0.26.0 pin | follow-up |
| `refactor-roadmap.md` | merged | folded into `simplification-plan.md` (the live tracker) | done |
| `/workflow`, `/audit` subpaths | undocumented | Document in README's subpath table or mark intentionally private | follow-up |

---

## Open decisions (need the lead)

1. **Home of `architecture-interpretations.md`.** Here, or in `agent-eval` (the selector/judge substrate spans both packages)?

*Resolved:* `agent-spine.md` / `ExecutionEnvironment` — **dropped**; the recursive-atom framing supersedes it and it is absent from `src/`.
*Resolved:* **`analyses` source (Phase 2)** — the diagnosis→steer edge lives on the agent-driver (`observe()` → `createCoordinationTools` over the `Scope`/`Supervisor`), and `run-loop.ts` stays analyst-free.
*Resolved:* **first selector signal (Phase 1)** — verifier-grounded (a runnable checker); answer-agreement measured negative on both corpora.

## Evidence anchors

- Agent-driver: `src/mcp/tools/coordination.ts` (`createCoordinationTools` — spawn · observe · steer · stop) over `src/runtime/supervise/` (`Scope`/`Supervisor`).
- Strategy program space: `src/runtime/strategy.ts` (`defineStrategy`/`ShotPersona`), `src/runtime/strategy-author.ts` (`authorStrategy`), `src/runtime/run-benchmark.ts` (`runBenchmark`/`Environment`).
- Selection: `src/runtime/run-loop.ts:983` (`defaultSelectWinner`), `:797` (`branchPoint`), `:104` (`selectWinner` inject); deployable selector = `bench/src/selector.ts` replayed via `corpus-replay.mts --selector`.
- Analyst proposal source: `src/analyst-loop/types.ts` (`KnowledgeProposalSource`); the trace observer feeding the canonical loop is `observe()` (`src/runtime/observe.ts`).
- Shared loop: `bench/src/refine-loop.ts` (`RefineLoopSpec`).
- Gate harness: the recursive diverse-vs-blind gate is `bench/src/gate.ts` (`runGate`) / `bench/src/gate-cli.mts`; `terminal-compare.ts` is a standalone compare runner. The flywheel runner (gen0 → `authorStrategy` → gen1 → holdout) is open work over `authorStrategy` (`src/runtime/strategy-author.ts`) + the seeded `promotionGate` (`src/runtime/promotion-gate.ts`).
- Measurement: `bench/src/corpus.ts` (RunRecord writer), `corpus-replay.mts` (offline selector replay), `corpus-report.mts` (`pairedLift` + BH-FDR); `@tangle-network/agent-eval` `statistics` (`requiredSampleSize`, `pairedMde`, `pairedBootstrap`, `benjaminiHochberg`, `cohensD`) and `/campaign` (`heldoutSignificance`, `pairHoldout`, `compareDrivers`); promotion = `src/runtime/promotion-gate.ts` (`promotionGate` — seeded paired bootstrap, evidence floor 6 paired tasks, CI lower bound must clear the threshold).
