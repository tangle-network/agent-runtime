# RSI Surface — Implementation & Cleanup Roadmap

Companion to [architecture.md](./architecture.md) (the spine) and [architecture-interpretations.md](./architecture-interpretations.md) (the coherence verdict). This is the operational, file-grounded build-and-cleanup sequence that turns the spine's §9 build order into concrete steps — from *scaffold built, intelligence designed* to a measured, world-class surface for all four framings (test-time-compute search, active learning / experimental design, program synthesis, two-timescale RSI). Every step cites the seam (`file:line`) and an exit gate. Grounded against `origin/main`.

## The principle: make it measurable before you build it

Everything is gated on the decision gate from [architecture-interpretations.md §5](./architecture-interpretations.md#5-the-decision-gate):

> Build the adaptive driver only if, at **equal worker-compute k**, a **trace+findings-fed** driver scored by a **sound non-oracle selector** beats **random@k** selected by that *same* selector — significantly, and surviving selector test-retest.

So the phases are ordered to make each step measurable on an honest baseline *before* the next is built. Build order: **honest baseline → the cheap win (selector) → wire the intelligence (analyses) → grow the language (ISA) → the use case (acquisition)**. The cleanup and doc tracks run in parallel because they are additive-safe.

---

## Phase map

| Phase | Goal | Depends on | Exit gate | Risk |
|---|---|---|---|---|
| **0** | Honest baseline + preconditions (no kernel change) | — | Every runner reports `random@k` at equal k; corpus has a measurable discordant-pair rate | low |
| **1** | Deployable non-oracle selector | 0 | `selector@k > random@k` significant (paired bootstrap + BH), low test-retest flip rate, on a frozen held-out split | low–med |
| **2** | Wire `analyses → driver` (the missing edge) | 0, 1 | **THE gate**: `refine@k-with-findings > random@k` at equal k under the Phase-1 selector, significant, survives test-retest | med |
| **3** | Grow the ISA (`select` then `seq`) | 2 | A planner emitting `select`/`seq` beats the flat-ISA planner on the same harness | med (3a) / high (3b) |
| **4** | Acquisition adapter (research use case) | 0, 1 (parallel to 2) | Active acquisition beats random acquisition on the deployable coverage-vs-budget curve under a *structural* gap signal | med–high |

---

## Phase 0 — Honest baseline + preconditions

**No kernel change.** Removes the confound that makes every steering number untrustworthy today.

- **Land `runPool`** — `bench/src/run-pool.ts` does not exist on `origin/main`; the bounded-concurrency idiom is duplicated across 5 sites (`run.ts:176/241/346`, `finsearch-loop.ts:123`, `terminal-compare.ts:476`). This is PR **#126** (open, CI-green, blocked only on review). Cleanup-track item 1.
- **Close the compute-vs-steering confound.** `bench/src/steering-experiment.ts:30-36` already makes the `random@k` control a *required* field, and `finsearch-loop.ts:207-216` wires it. But `run.ts` `batch-compare` (`run.ts:295-396`, agg = `{blind, refine, gained, lost}`) and `terminal-compare.ts:500-512` report blind-vs-refine **without** a `random@k` arm — so their "refine" delta is compute-confounded. Route both through `runSteeringExperiment` and add the `random@k` arm (copy `finsearch-loop.ts:90-96`).
- **PRECONDITION CHECK (blocking).** Verify there is `k>1` answer **diversity** in the corpus. `run.ts:227-231` notes a near-deterministic model makes `oracle@k ≈ pass@1` (identical shots) — a no-oracle selector then has *nothing to choose among* and Phase 1 is unmeasurable (0 discordant pairs). Generate the corpus with `MODELS` heterogeneity or temperature > 0 and confirm a non-zero discordant-pair rate before spending on Phase 1.

**Exit gate:** all three runners report `random@k` at equal k; the corpus exhibits a measurable discordant-pair rate.

## Phase 1 — Deployable non-oracle selector

The selector is currently **faked with the judge**: `defaultSelectWinner` (`run-loop.ts:616-639`) and `branchPoint` (`run-loop.ts:471-486`) rank by `verdict.score`, and in the bench the validator *is* the judge (`finsearch-loop.ts:143-149`). So every `random@k`/`refine@k`/`oracle@k` number is judge-selected (an oracle upper bound). This phase builds the deployable ranker — the piece that actually makes best-of-N pay.

- **Build `rank(attempts: AttemptRecord[]) -> index`** — a pure function over *stored outputs/traces only* (self-consistency / answer-agreement / a PRM). Never reads `verdict`. (Open: evaluate `@tangle-network/agent-eval`'s `/prm` subpath before hand-rolling agreement scoring.)
- **Inject** via `RunLoopOptions.selectWinner` (`run-loop.ts:95`, honored at `:550`) and `createFanoutVoteDriver.selector` (`fanout-vote.ts:34`). No kernel surgery. Note: `branchPoint` (`run-loop.ts:471`) also ranks edge lineage on `verdict.score` — make it selector-aware for a fully oracle-free deployment.
- **Measure OFFLINE first** via `corpus-replay.mts`'s `scoreCandidateOffline` seam: per instance, pick one of the k stored outputs, then judge only the pick (zero new rollouts; deterministic judges free, LLM judge = 1 call/instance). Report `selector@k − random@k` (PRIMARY family) and `selector@k − oracle@k` (exploratory headroom-gap) as `TestEntry` rows in `corpus-report.mts` (reuse `pairedLift` + `benjaminiHochberg`). Compute the **test-retest** flip rate from the same corpus (run the picker twice; report flip fraction + paired-bootstrap CI). Power with `requiredSampleSize`/`pairedMde` from `agent-eval/statistics`.
- **Ship gate** via `heldoutSignificance(pairHoldout(...))` (the `gepa-refine.ts:273-281` pattern) or `compareDrivers`, on a frozen held-out split disjoint from the threshold-tuning split.

**Exit gate:** `selector@k > random@k` (paired bootstrap, BH-FDR) with a low test-retest flip rate, on a frozen held-out split.

## Phase 2 — Wire `analyses → driver`

The load-bearing edge. `PlannerContext` (`dynamic.ts:51-60`) carries only `{task, history, iterationsSpent, iterationsRemaining}`; `runAnalystLoop` has zero consumers under `src/loops/drivers/`. The driver decides from a verdict score, not a diagnosis.

- **Add** `analyses?: ReadonlyArray<AnalystFinding>` to `PlannerContext` (`dynamic.ts:51-60`), importing `AnalystFinding` from `@tangle-network/agent-eval` (substrate type at `dist/types-*.d.ts`; **do not redefine** — layering rule).
- **Source it caller-side** (preferred over a kernel `analyze` hook, to keep `run-loop.ts` dependency-clean per CLAUDE.md): the caller builds `analyses` from `runAnalystLoop` output and threads it via the planner closure. Render it in `sandbox-planner.ts` `defaultBuildPrompt` (`:201-222`), `finsearch-loop.ts` `refinePlanner` (`:71-83`), and add an `analyses` param to `bench/src/refine-loop.ts`'s `prompt` fn (`:50`). Keep optional + fail-loud so `randomPlanner`/`fanout` compile unchanged.
- **Measure** the analyses-fed planner as another treatment arm against the same `random@k` control and the Phase-1 selector.

**Exit gate — the decision gate.** `refine@k-with-findings > random@k` at equal k under the Phase-1 selector, statistically significant, surviving selector test-retest. **If it fails:** stop. Ship Phases 0–1 + Phase 4 (agentic RAG with a verifier) and delete the steering machinery. The recursive-driver layer is unjustified overhead unless this clears.

## Phase 3 — Grow the ISA (program synthesis)

`TopologyMove` (`dynamic.ts:43-48`) is a flat 3-opcode enum `{refine, fanout, stop}`; `select` and `seq` are interpreter builtins the planner cannot author. Only worth doing once Phase 2 gives the planner a real signal to author non-trivial programs.

- **3a — emittable `select`** (additive, no cadence change). Turn the implicit `defaultSelectWinner`/`branchPoint` pick into a planner move `{kind:'select'; from; rationale?}`. Extend the union + `validateMove` (`dynamic.ts:161`) + `describePlan` (`:140`) + `envelopeToMove` (`sandbox-planner.ts:122`) + `TopologyMoveEnvelope` (`:42`) + `defaultBuildPrompt`.
- **3b — `seq`/sub-program** (high risk). `{kind:'seq'; steps; rationale?}` needs the kernel to execute a sub-program within one `plan()` round — today `plan()` returns a flat `Task[]` and the kernel runs one batch per round (`run-loop.ts:165-247`). Either a kernel sub-program executor (plan returns a tree) or a driver-internal step cursor over `pending` (`dynamic.ts:109`); the latter avoids kernel changes but spreads a `seq` across multiple trace events (affects the topology viewer). Do this last.

**Exit gate:** a planner emitting `select`/`seq` beats the flat-ISA planner on the same harness.

## Phase 4 — Acquisition adapter (the research use case)

Runs in **parallel** to Phases 1–2 (bench-only, no kernel code). This is the knowledge-acquisition loop framed as active learning / experimental design over sources.

- **Build a `RefineLoopSpec<WikiState, AcquisitionCtx>`** over `runRefineLoop` (`refine-loop.ts:44-63`): `setup` = open/create the vault; `prompt(round, history)` = the maintainer directive folding prior pages + open contradictions; `runShot` variants = (i) an `llm-wiki` maintainer+critic (ingest → propose page edits → lint contradictions/staleness/orphans) and (ii) a `bad`-CLI browser source-fetcher reusing `bench/src/browser/adapters/bad.ts` for web data/video/images; `judge` = the critic's lint verdict; `teardown` = flush the vault.
- **Persist via the existing `KnowledgeAdapter`** (`analyst-loop/types.ts:25-42`, `agent/knowledge-adapter.ts:61`) through `runAnalystLoop` — proposals → wiki writes go through the seam, **not** a side channel.
- **The gap signal must be STRUCTURAL** — graph topology, citation/embedding density, redundancy-discounted coverage — **not an LLM vibe.** A miscalibrated acquisition function underperforms random sampling ([interpretations §3.2](./architecture-interpretations.md#32-active-learning--experimental-design)); the structural signal is what makes this active learning rather than coverage-greedy ingestion.
- **No mocks** — real vault, real `bad` runs (repo doctrine).
- If source-selection runs through `runLoop` as a `TopologyPlanner`, it maps onto the emittable `select` (then this phase gains a dependency on Phase 3a).

**Exit gate:** active acquisition beats random acquisition on the deployable coverage-vs-budget curve (held-out, write-only downstream judge) under the structural gap signal.

---

## Cleanup track (parallel, additive-safe)

| # | Item | Seam | Action | Risk |
|---|---|---|---|---|
| 1 | Hand-rolled pools | `run.ts:176/241/346`, `finsearch-loop.ts:123`, `terminal-compare.ts:476` | Land PR #126 (`runPool` → all 5 sites) + a `run-pool.test.mts` self-check | low |
| 2 | Decentralized directive | `worker-browser.ts:44` | Move `DEFAULT_MIND2WEB_DIRECTIVE` into `directives.ts` (the doctrine that file states) | low |
| 3 | `RunRecord` name collision | `bench/src/corpus.ts:22,38` | Rename bench's `RunRecord`/`AttemptRecord` → `FlywheelRunRecord`/`-Attempt` (collides with substrate `RunRecord`) | low |
| 4 | `createRefineDriver` redundancy | `src/loops/drivers/refine.ts` (0 consumers, public+tested) | **After Phase 2:** refold into a named `PROMPT_PLANNERS` entry over `createDynamicDriver` (the `refinePlanner` pattern), deprecate via public-API process — do **not** delete cold | med |
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
| `refactor-roadmap.md` | needs-update | Prune closed R-items (R5 verifiably stale) per its own close-by-deletion rule | follow-up |
| `/workflow`, `/audit` subpaths | undocumented | Document in README's subpath table or mark intentionally private | follow-up |

---

## Open decisions (need the lead)

1. **`analyses` source (Phase 2).** Caller-side closure threading (keeps `run-loop.ts` dependency-clean, leans with the layering rule) vs a kernel `RunLoopOptions.analyze` hook (generic but couples `run-loop` to the analyst import). Roadmap assumes caller-side.
2. **First selector signal (Phase 1).** Self-consistency vs pairwise answer-agreement vs a learned PRM (the `agent-eval/prm` subpath is unexplored).
3. **Home of `architecture-interpretations.md`.** Here, or in `agent-eval` (the selector/judge substrate spans both packages)?

*Resolved:* `agent-spine.md` / `ExecutionEnvironment` — **dropped**; the recursive-atom framing supersedes it and it is absent from `src/`.

## Evidence anchors

- Driver/ISA gap: `src/loops/drivers/dynamic.ts:43-48` (`TopologyMove`), `:51-60` (`PlannerContext`), `:203-220` (`summarizeHistory`).
- Live planner: `src/loops/drivers/sandbox-planner.ts:201-222`; deterministic control: `src/loops/drivers/planners.ts`.
- Oracle selection: `src/loops/run-loop.ts:616-639` (`defaultSelectWinner`), `:471-486` (`branchPoint`), `:95/:550` (`selectWinner` inject), `:384` (verdict write); `fanout-vote.ts:34` (selector inject); `finsearch-loop.ts:143-149` (validator = judge).
- Analyst seam: `src/analyst-loop/types.ts:25-42` (`KnowledgeAdapter`); `runAnalystLoop` consumers = `src/loop-runner.ts:286`, `src/agent/*` (none under `src/loops/drivers/`).
- Shared loop: `bench/src/refine-loop.ts:44-63` (`RefineLoopSpec`).
- Gate harness: `bench/src/steering-experiment.ts:30-36` (required control), `finsearch-loop.ts:90-96/207-216` (`randomPlanner` + experiment), `run.ts:205-292` (`batch-oracle`), `:295-396` (`batch-compare`), `terminal-compare.ts:500-512`.
- Measurement: `bench/src/corpus.ts` (RunRecord writer), `corpus-replay.mts:29-35` (`scoreCandidateOffline`), `corpus-report.mts:215-285` (`pairedLift` + BH-FDR); `@tangle-network/agent-eval` `statistics` (`requiredSampleSize`, `pairedMde`, `pairedBootstrap`, `benjaminiHochberg`, `cohensD`) and `/campaign` (`heldoutSignificance`, `pairHoldout`, `compareDrivers`).
