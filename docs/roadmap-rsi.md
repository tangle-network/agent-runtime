# RSI Surface — Implementation & Cleanup Roadmap

Companion to [architecture.md](./architecture.md) (the spine) and [architecture-interpretations.md](./architecture-interpretations.md) (the coherence verdict). This is the operational, file-grounded build-and-cleanup sequence that turns the spine's §9 build order into concrete steps — from *scaffold built, intelligence designed* to a measured, world-class surface for all four framings (test-time-compute search, active learning / experimental design, program synthesis, two-timescale RSI). Every step cites the seam (`file:line`) and an exit gate. Grounded against `origin/main`.

## The principle: make it measurable before you build it

**Gate A** tests within-run steering ([architecture-interpretations.md §5](./architecture-interpretations.md#5-gate-a--a-diagnostic-for-within-run-steering)):

> Does a trace-informed driver beat random attempts under the same answer selection method, at equal actual resources, with enough evidence to distinguish useful improvement?

Project success is **Gate B**: improvement across projects under the criteria in [architecture.md §0.5](./architecture.md#05-what-we-are-building-and-what-better-means-the-four-claims).
Apply [architecture.md §9](./architecture.md#9-build-order-and-experiment-scope) before using Gate A to reject a mechanism or choose another experiment.
The phase map below records the within-run investigation; it does not make that investigation a prerequisite for testing learning across projects.

The phases organize that investigation around measurable behavior.
Use the canonical experiment scope when choosing a different order or testing interacting mechanisms together.

> **Status (updated POWER-16).** The canonical "drive an agent" path is the **agent-driver**:
> an `AgentProfile` driving another via `createCoordinationTools`
> (`src/mcp/tools/coordination.ts`) over the `Scope`/`Supervisor`
> (`src/runtime/supervise/`), plus `runAgentic`/`defineStrategy`/`runPersonified`
> (`strategy.ts`/`persona.ts`); the `runAgentRounds` kernel (`src/runtime/run-loop.ts`) is
> one leaf backend. **Gate A's +16.4pp anchor was
> retracted as a confirmed gain; the larger follow-up is inconclusive.** On the canonical `Scope`/`Supervisor` + `observe()` +
> `defineStrategy` loop the n=16 EOPS-itsm signal (depth +16.4pp CI [+5.3, +29.8], 6W/0L,
> deepseek-v4-pro; +8.3pp disjoint) did **not** replicate: at n=48 depth−breadth = +4.7pp
> CI [−1.9, +11.4] (+4.1pp at n=72). The n=48 interval includes both zero and a useful gain.
> It cannot establish superiority or equivalence. The program pivoted off this anchor (`.evolve/current.json`). It remains
> domain-bounded: negative on stateless retrieval (FinSearchComp),
> null-to-negative on stateless codegen (HumanEval; exec-grounded repair −17.1pp). The
> live optimization portfolio is
> [docs/research/optimization-space.md](./research/optimization-space.md). **Gate B
> (across-run, multi-objective) remains the success criterion and remains
> uninstrumented**; its minimal single-objective form is the gen0 → `authorStrategy`
> (`src/runtime/strategy-author.ts`) → gen1 → rotating disjoint holdout under the seeded
> `promotionGate` (`src/runtime/promotion-gate.ts`) flow — standing that runner up over those
> primitives is the open work. Per-phase status is in the phase map.

Report `pass@1` and `pass^k` for every repeated task family, with the chosen `k` and independent task counts.
Here `pass^k` is the share of tasks whose checked outcome succeeds on every one of `k` capped attempts.
Report total search, validation, deployment, and serving cost, then divide by verified successful tasks with the denominator shown.
When there are no verified successes, report cost per success as undefined rather than zero.
For promotion, the conservative lower bound on added verified-outcome value over the registered horizon must exceed search, validation, and deployment cost.
Apply this economic rule alongside the unchanged outcome, safety, latency, and cost guardrails.

---

## Phase map

| Phase | Goal | Depends on | Exit gate | Risk | Status (2026-06-10) |
|---|---|---|---|---|---|
| **0** | Honest baseline + preconditions (no kernel change) | — | Every runner reports `random@k` at equal k; corpus has a measurable discordant-pair rate | low | **done** — `runPool` landed (`bench/src/run-pool.ts`); the corpus + `corpus-report.mts` BH-FDR path is the `random@k`-control measurement surface |
| **1** | Deployable non-oracle selector | 0 | `selector@k > random@k` significant (paired bootstrap + BH), low test-retest flip rate, on a frozen held-out split | low–med | **built + measured** — verifier-grounded selector positive on HumanEval (+12pp verifier−sc CI [+4,+22] / +18pp random−blind, BH-sig, n=50 k=4); answer-agreement negative (finsearch −8.2pp, aec −9.4pp) |
| **2** | Wire `analyses → driver` (the missing edge) | 0, 1 | **Gate A**: compare within-run steering under the [canonical experiment scope](./architecture.md#9-build-order-and-experiment-scope) | med | the diagnosis→steer edge lives on the agent-driver (`observe()` → `createCoordinationTools`); the n=48 Gate A interval is inconclusive (header note) |
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

**Exit criterion — Gate A.** `refine@k-with-findings > random@k` at equal actual resources under the Phase-1 selector, with statistical support and repeatable selection.
Apply [architecture.md §9](./architecture.md#9-build-order-and-experiment-scope) when interpreting a result below the useful threshold.

**Gate A status: inconclusive at n=48 (POWER-16), on the `Scope`/`Supervisor` substrate.** The n=16 "+16.4pp cleared" signal (depth-steered continuation, analyst-fed via `observe()`, vs blind breadth at equal compute under keep-best scoring) did not remain a confirmed gain: depth−breadth was +4.7pp, CI [−1.9, +11.4], at n=48 (header note). The interval does not rule out a useful gain or zero; the program pivoted off this anchor.

**POWER-16 source audit (2026-09-24).**
The saved four 12-row shards omit task IDs and a pinned dataset revision.
The runner fetched consecutive offsets 0–47 from the public EnterpriseOps-Gym ITSM oracle split.
The current dataset revision `c8e538eae8a6205294f0a86675fefdc1fac408f6` was last modified on 2026-04-30, before the run.
Mapping its rows to those offsets yields 48 distinct task IDs.
All 48 IDs occur in archived June 10–12 `agent-lab` results, before POWER-16.
Seven seed database files underlie the 48 tasks; two supply 42 tasks.
The cases were therefore reused at the program level, not an untouched final cohort.
The earlier artifacts do not establish which rows a POWER-16 candidate author or treatment agent saw.
Direct treatment leakage is unproved.
The source census is reproducible from [the saved POWER-16 shards](https://github.com/tangle-network/agent-lab/tree/1418eddf558058faeefb8a1706707b11aefc909f/runs/2026-06-13) and the preceding run archive in the same private repository.

### RSI v3 evidence corrections

The September 24 RSI v3 audit is a proposed research program, not a live result.
Its export is bundle `9ad8d350`, conversation `6ab47d87-5e38-83e9-b354-00fb3347af33`, ledger item `it-7a70578d15`.
The retained `FULL_REPORT.md` has SHA-256 `abd320e9ef528b94a3c5b4e855d97f094d6ab8495fbaa60e3affb7186081ac58`.
The experiment and integration chapters match the original export byte for byte.

Three corrections accompany the Gate A record; they concern different populations.

- The supplied merged-PR fraction is 910/969 = **93.91%**, not 97.9%.
  The supplied category counts sum to 1,048; overlap and the claimed 1,045 distinct runs remain unresolved.
  These arithmetic checks do not validate the underlying census or measure agent quality.
- The separate cold grader ordered 9/24 pairs correctly: **37.5%, Wilson 95% CI [21.2%, 57.3%]**.
  The interval includes chance, so reliable inversion is unsupported.
  Reversing this grader requires a new calibration bank and independent confirmation.
- Gate A remains **+4.7 pp, n=48, CI [-1.9, +11.4], inconclusive**, on reused source tasks.
  Neither the PR fraction nor the cold-grader sample changes that result.

ADC [#7737](https://github.com/tangle-network/agent-dev-container/pull/7737) merged into `develop`; ancestry alone does not establish deployment.
ADC [#7785](https://github.com/tangle-network/agent-dev-container/pull/7785) merged on September 24; it is no longer an open draft.
Its merge does not prove served candidate generation, activation, or live improvement.
At the September 26 source check, Runtime main and public npm both report 0.277.0.
The audit's older package cohort must be refreshed before execution.

### Selected experiments and decision order

The following decisions apply to v3's fifteen experiment proposals.
They retain the existing [live-loop contract](./live-agent-improvement-loop.md) and [FAIL scorecard](./recursive-improvement-readiness.md).
Preparation uses existing evidence and costs zero model dollars during quota triage.
Paid runs remain held by the current quota instruction; the audit supplies no spending authority.
The clocks below concern preparation, not delivery of credentials or an enrolled cohort.

| Audit experiment | Decision and concrete next check | Owner / preparation clock |
| --- | --- | --- |
| E01: evidence reconstruction | ADAPT. Preserve the 48-task reuse census; recover missing transfer arms before another search. Two of three transfer records are reconstructible. Report each source, missing arm, count metric, interval, and cost without promoting summaries to certification. | Eval / September 26 |
| E02: capture, cost, restore | ADAPT within existing owners. Router #549 fixes failed-dispatch cost handling in source. Join 30 distinct fault scenarios separately from 300 ordinary episodes; require restoration hashes, all descendants, and no double bills or false zero costs. Historical charges still need independent settled receipts. | Eval joins; Platform billing and trace owner / September 27 |
| E03: grader validity | ADAPT. Keep the failed 40-root GTR screen sealed. The trace checker needs at least 60 new independent claim groups, two blind raters, at least 90% agreement, and separate 60-bad/60-good controls with distinct error bounds. For a broader product-quality ruler, use 200 fresh known-pair examples and require a Wilson lower bound above 0.60. | Eval; product reviewer for product labels / September 26 registration |
| E04: replay noise | ADAPT. First replay retained observations without model calls. Then, when quota permits, compare the same profile on 50 independent development groups with two paired repetitions, 200 execution calls. Separate execution, grader, and environment variation. Qualify the actual compound gate on at least 10,000 seeded null simulations. | Eval / September 26 registration |
| E05: fixable failures | ADAPT. Obtain 40 representative failures with checked task outcomes. Compare no change against source context, repaired read-only tool output, concise instruction, and equal-cost retry. Tool transport success and nonzero shell exit are insufficient task labels. Confirm one selected intervention on new groups. | Eval and consumer owner / September 27 source check |
| E06: authored same-path change | ADAPT. Qualify six real cases on the served entrypoint, use 40 development cases, then an 80-new-group exploratory paired screen. The focus confirmation requires at least 200 buyer-labelled graded replies, with the final count set by native power and clustering. Use one immutable manifest per study and one final decision. | ADC ops-board #1428; work:adc serves; Eval assesses / September 26 contract |
| E07: retained learning | ADAPT. Preserve Gate B's at-least-100-fresh-pair headline screen and add the existing reset-learning-state arm beside retained and frozen arms. Verify the learned artifact is loaded after restart. Register a larger confirmation if its power requires it; report all learning, evaluator, and serving costs. | Eval and Runtime research owner / September 27 registration |
| E10: optimizer transfer | DEFER execution until the grader and receipt joins qualify. Compare no change, example selection, direct authored edit, and automatic proposals on 80 development groups with equal all-in budgets. Nominate before fresh final groups. Use three search seeds for screening; method claims need outer-run uncertainty. | Eval / September 28 registration |
| E12: served transfer | ADAPT after scoped receipts. Freeze the candidate, randomize independent conversation families, keep shadow actions inert, and join independent outcome to settled cost. Execute the full-state rollback drill before canary. The live headline requires a 95% lift interval excluding zero. | Eval; product activation owner / September 27 manifest |
| E08: compiled cards | DEFER. No enrolled buyer cohort or equal-information comparison is established; this cannot substitute for the live-agent target. | Existing Supervisor-lab and buyer owner |
| E09: selection and stopping | DEFER this lane's execution during quota triage. The existing benchmark owner must separate selector and stopping treatments with fresh final checks. | Runtime benchmark owner |
| E11: recursive topology | DEFER to Discovery's existing E1 owner. Preserve its registered resource law and attempted-pair count; do not launch a competing campaign here. | Discovery research owner |
| E13: public benchmarks | DEFER execution during quota triage. Retain the existing two-benchmark lane; selected task screens cannot certify live efficacy. | Existing Runtime benchmark owner |
| E14: supervised training | DEFER. Checked, permitted, independent training groups and the required label inventory are absent. | Data and Eval owners |
| E15: improve the improver | DEFER execution until retained-learning and optimizer-transfer results provide outer-run variance. A selected better candidate alone cannot support this claim. | Research owner |

If a tool or missing source dominates E05, fix that mechanism before spending on prompt search.
If direct editing beats search under equal resources, retain the edit and test a different search mechanism.
Record clean negative and insufficient-evidence decisions with the original attempted denominator.
Do not retry only the timed-out row of the failed fixed 40-root screen.

### Manifest, paging, and power requirements

The inspected ADC comparison schema still accepts 6–20 cases and a $0.12–$100 budget.
It accepts exact or structured grading with a 16 KiB case limit.
An 80-case screen or 200-case confirmation needs the existing ADC owner's paged study implementation.
Do not chain independently decided 20-case jobs.

Before admission, bind one content digest to ordered cases, independent groups, source revisions, arms, and candidate materialization.
Also bind the registered evaluator, executor cohort, resource bounds, exclusion policy, stopping rule, and final decision procedure.
Separate permissioned inputs from hidden answers and reviewer labels.
Execution pages share the manifest, reservation, and experiment identity.
Use stable execution keys for experiment, arm, case, repetition, and executor materialization.
Reconcile unknown execution after timeout; changing a transport request ID does not authorize rebuying the case.
Count failed, missing, interrupted, and late cases under the registered policy.
Assess the full admitted frame once after reconciliation; a missing page cannot shrink the denominator.

The paired-binary planning approximation reproduces 157 pairs for a +10 pp effect, q=0.20, alpha=0.05, and 80% power.
At alpha=0.025 it gives 191; a +5 pp effect gives 628 and 761 respectively.
These counts precede clustering and compound-gate conditions; they are not qualified sample sizes.
An unpaired live trial requires its own power calculation.
Pooled F1 requires source-cluster count resampling, not this binary formula.
Use the existing Eval power implementation with the exact joint decision, null law, and plausible alternatives before sealing confirmation.
Choose the final count with one seed, then require an independent simulation's 95% lower power bound to reach the registered target.
Do not repeat seeds until a favorable crossing appears.
Predeclare multiplicity control before admitting another release nomination.

The proposed fifteen protocols are selected or deferred above, not certified by the audit.
Its $2,000 program envelope and staff-hour plan remain unverified planning proposals.
No sealed live cohort, settled historical-charge audit, or live PASS follows from this registration.

## Phase 3 — Grow the ISA (program synthesis)

**Status: superseded by `defineStrategy`.**

The program-synthesis path is `defineStrategy` (`src/runtime/strategy.ts`): a strategy is ordinary code composing `shot()`/`critique()` with arbitrary sequencing, branching, and state, and `authorStrategy` (`src/runtime/strategy-author.ts`) makes it agent-authorable. `select`/`seq` are expressed directly in strategy code rather than as an emittable move enum. Program-space work happens there.

**Exit gate (carried by the strategy substrate):** an authored strategy (`authorStrategy`, `src/runtime/strategy-author.ts`) beats the incumbent on a frozen holdout under `promotionGate` (`src/runtime/promotion-gate.ts`); standing that runner up over those primitives is the open work.

## Phase 4 — Acquisition adapter (the research use case)

Runs in **parallel** to Phases 1–2 (bench-only, no kernel code). This is the knowledge-acquisition loop framed as active learning / experimental design over sources.

- **Build a `RefineLoopSpec<WikiState, AcquisitionCtx>`** over `runRefineLoop` (`refine-loop.ts:44-63`): `setup` = open/create the vault; `prompt(round, history)` = the maintainer directive folding prior pages + open contradictions; `runShot` variants = (i) an `llm-wiki` maintainer+critic (ingest → propose page edits → lint contradictions/staleness/orphans) and (ii) a `bad`-CLI browser source-fetcher reusing `bench/src/browser/adapters/bad.ts` for web data/video/images; `judge` = the critic's lint verdict; `teardown` = flush the vault.
- **Propose through `runAnalystLoop`, measure through `runKnowledgeImprovementJob`, and write only through `createKnowledgeImprovementActivationExecutor`.** Analysis never mutates the live knowledge tree.
- **Validate gap signals against outcomes.** Structural features and model judgments are possible inputs to problem selection.
  Neither establishes useful practice without a downstream comparison ([interpretations §3](./architecture-interpretations.md#3-five-interpretations)).
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
- Strategy program space: `src/runtime/strategy.ts` (`defineStrategy`/`ShotSpec.profile`), `src/runtime/strategy-author.ts` (`authorStrategy`), `src/runtime/run-benchmark.ts` (`runBenchmark`/`Environment`).
- Selection: `src/runtime/run-loop.ts:983` (`defaultSelectWinner`), `:797` (`branchPoint`), `:104` (`selectWinner` inject); deployable selector = `bench/src/selector.ts` replayed via `corpus-replay.mts --selector`.
- Analyst proposal source: `src/analyst-loop/types.ts` (`KnowledgeProposalSource`); the trace observer feeding the canonical loop is `observe()` (`src/runtime/observe.ts`).
- Shared loop: `bench/src/refine-loop.ts` (`RefineLoopSpec`).
- Gate harness: the recursive diverse-vs-blind gate is `bench/src/gate.ts` (`runGate`) / `bench/src/gate-cli.mts`; `terminal-compare.ts` is a standalone compare runner. The flywheel runner (gen0 → `authorStrategy` → gen1 → holdout) is open work over `authorStrategy` (`src/runtime/strategy-author.ts`) + the seeded `promotionGate` (`src/runtime/promotion-gate.ts`).
- Measurement: `bench/src/corpus.ts` (RunRecord writer), `corpus-replay.mts` (offline selector replay), `corpus-report.mts` (`pairedLift` + BH-FDR); `@tangle-network/agent-eval` `statistics` (`requiredSampleSize`, `pairedMde`, `pairedBootstrap`, `benjaminiHochberg`, `cohensD`) and `/campaign` (`heldoutSignificance`, `pairHoldout`, `compareDrivers`); promotion = `src/runtime/promotion-gate.ts` (`promotionGate` — seeded paired bootstrap, evidence floor 6 paired tasks, CI lower bound must clear the threshold).
