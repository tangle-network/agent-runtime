> **Track:** Architecture (research) · **Role:** formal research plan / fund-or-kill audit · **Status:** LOCAL working artifact (uncommitted — not pushed)

<!-- Source: workflow w1mo90utm — kill-it red-team + steelman + intent-archaeology + infra-auditor → synthesis → plan. Ground-truthed against bench/corpus/*.jsonl + src/loops/ @ gen6. The honest verdict: KILL the RSI frame, PARK orchestration, SHIP the instrument + abstention. Cross-links: architecture-alternatives.md, observed-orchestration-patterns.md, aec-bench-gate-result (memory). -->

All binding facts are now ground-truthed against the live corpus and code:

- **finsearch deployable selector: −8.2pp** (selector 45.1% vs random@k 53.3%, n=51, oracle ceiling 62.7% → 17.6pp left on table) ✓
- **aec-diverse deployable selector: −9.4pp** (selector 25.0% vs random@k 34.4%, n=16, oracle ceiling 50.0% → **25pp left on table even with diversity**) ✓
- The diverse-arm keystone is **already run offline** and the deployable selector loses there too — the selection bottleneck survives diversification.
- Stats path has paired bootstrap + BH + infra-error exclusion ✓; the firewall (`assertTraceDerivedFindings`) rejects judge-derived provenance ✓.
- The sandbox stream-drop / content-addressed dedup (A5) is referenced but I confirmed it's the offline path that's reliable.

I have what I need. Writing the plan.

---

# Formal Research Plan — agent-runtime: The Honest Measurement Apparatus

**PI decision document. Fund-or-kill. Every claim ground-truthed against the committed corpus (`bench/corpus/*.jsonl`) and `src/loops/` as of `6807265` (gen 6).**

---

## 1. The Honest Reframe

Stripped of the RSI/AGI narrative, **this program built a rare, confound-resistant measurement instrument for the question "does agentic structure beat blind compute at equal cost?" — and then spent gen 6 building topological mechanism (the recursive atom, personify combinators, the learned-planner wire, the belief learner) that the instrument has not yet earned.** The instrument is real and load-bearing: equal-k holds *by construction* (atomic reserve/refund in `src/loops/supervise/`), selection is firewalled from the judge (`assertTraceDerivedFindings`, `src/loops/drivers/dynamic.ts:344`), and the gate runs offline over a content-addressed corpus with paired-bootstrap + Benjamini-Hochberg (`bench/src/corpus-report.mts`). I re-ran the gate during this analysis: on the committed corpora the deployable selector **loses to a blind draw on both benchmarks** — finsearch −8.2pp (n=51) and, decisively, **aec-diverse −9.4pp (n=16) even though diversity opened a 25pp oracle ceiling that the selector could not capture.** Where structure *does* win (the aec oracle: 50% vs 2.5% per-attempt floor), it wins by amortized search against a runnable checker — that is FunSearch, not self-improvement. The mechanism is debt; the negatives are the asset.

> **Mission that survives the evidence:** *An honest equal-compute instrument for orchestration claims, plus a verifier-gated abstention product — not a self-improving agent.*

---

## 2. The Intent Split

The five intents collapsed into one apparatus because RSI was treated as the goal and everything else as scaffolding. Invert it:

| Intent | Right instrument | Right metric | Honest status (ground-truthed) | **Decision** |
|---|---|---|---|---|
| **1. SCIENCE** — does non-blind topology beat blind at equal k? | Equal-k pool + firewall + offline corpus replay (`corpus-replay --selector`) | `selector@k − random@k`, paired bootstrap + BH, n≥40 | **Falsified twice on deployable selector** (finsearch −8.2pp n=51; aec-diverse −9.4pp n=16). Oracle ceiling is large (aec +25pp left on table). The bottleneck is **selection, not generation.** | **OPEN** — but reframe from "does topology help" to "does a *verifier-grounded* selector capture the oracle ceiling." Run H1–H3, accept the answer. |
| **2. PRODUCT** — fleet abstention/provenance (tax/legal/insurance) | Conformal selective prediction over the exchangeable corpus + conserved pool | Risk-coverage curve; abstention precision at target coverage; provenance completeness | Offline-executable on committed corpora today. **Does not depend on beating blind.** No producer wired yet (R1 in the agenda is spec-only). | **SHIP** — the only deployable-today asset. Highest ROI, lowest risk. |
| **3. CAPABILITY** — orchestration generality | `runProgram` op-set + personify combinators (`src/loops/personify/`) | n/a (expressiveness, not a metric) | **Shipped (#141/#152). Moved zero metric, by design.** Full topological expressiveness exists. | **PARK** — shipped and idle at zero carrying cost. Available the instant a positive gate justifies it. Build *no more* of it. |
| **4. RSI / AGI** — self-improving outer loop | (none — no signal to learn from) | (none) | **Phantom on the measured world.** Belief-learner spec self-admits "ships nothing" on finsearch −8.2pp / coding 0.0pp. PR #155 correctly CLOSED. | **KILL the frame.** Re-enter only through a positive verifier-grounded gate, and rename it "amortized search against a checker," not self-improvement. |
| **5. MOAT / INFRA** — reusable substrate | Equal-k-by-construction + deterministic seq-replay + selector≠judge firewall | Reproducibility (replay agreement %); confound count = 0 | **Real and the actual moat.** The −8.2/−9.4pp negatives are *trustworthy because the firewall holds.* This is what most orgs lack. | **SHIP + harden** (A5 dedup). The instrument is the defensible asset; its negative results are the product. |

---

## 3. Falsifiable Hypotheses (ranked; offline-first)

Lead with offline hypotheses on the committed corpora (seconds, deterministic, zero rollout). Live-rollout hypotheses are gated behind A5 (content-addressed dedup) because the corpus denominator is unstable under correlated stream-drop.

### H0 (META — the thesis we keep avoiding; try hard to FALSIFY it)
**Claim:** On text-only channels with no deployable checker, *no deployable (non-oracle) selector over any topology beats a blind draw at equal k.*
**Prediction:** `selector@k − random@k ≤ 0` for every selector × topology cell on finsearch and aec.
**Experiment (offline, already partially run):** `corpus-replay --selector` across `{homogeneous, diverse}` × `{self-consistency, …}`. Sweep every selector variant the corpus admits.
**Decision rule:** H0 **confirmed** (kills the orchestration direction for text channels) if all cells ≤ 0 with BH-significant or null deltas. **Falsified** if any deployable selector clears `random@k` by a BH-significant margin at n≥40.
**Current evidence:** finsearch −8.2pp (n=51), aec-diverse −9.4pp (n=16). **H0 is currently winning.** This is the result the program must be willing to publish.
**Cost:** ~minutes, already on disk.

### H1 — Diversity helps *generation* but a self-consistency selector cannot *capture* it (offline)
**Claim:** Approach-diversity raises the oracle ceiling but self-consistency selection cannot convert it; the gap is the selection problem, not the generation problem.
**Prediction:** `oracle@k(diverse) ≫ oracle@k(homogeneous)` while `selector@k(diverse) ≈ blind`.
**Experiment:** `corpus-replay corpus/aec-diverse.jsonl --selector --condition=diverse` (run during this analysis).
**Decision rule:** Confirmed if oracle−selector gap ≥ 10pp with selector ≤ blind.
**Result (measured):** oracle 50.0%, selector 25.0% = blind 25.0%, **gap +25.0pp; selector−random −9.4pp. CONFIRMED.** Diversity is real signal; self-consistency is the wrong picker.
**Cost:** done.

### H2 — A verifier-grounded selector (refuter / runnable tests) captures the diversity ceiling where a checker exists (offline-first, then 1 small live arm)
**Claim:** On a domain with a *deployable checker* (aec runnable tests; program synthesis), a selector that scores candidates by running the checker — not by self-consistency — captures a BH-significant share of the oracle ceiling.
**Prediction:** `selector_checker@k − random@k > 0`, BH-significant, on aec-diverse; near-zero on finsearch (no total checker) — the *contrast* is the result.
**Experiment:** (a) **offline** if per-attempt checker verdicts are recoverable from the aec corpus (they are partially `None` today — first action is to re-emit the diverse corpus *with* per-attempt verdicts populated); (b) **1 live arm**: `diverse-gate.mjs` with a checker-scored selector on aec, k=4, n≥30, after A5. This is **not mechanism-ahead** — it spends k→k+1 on shipped infra and directly attacks the −9.4pp selection loss.
**Decision rule:** Confirmed if aec `selector_checker − random` is BH-significant > 0; falsified if ≤ 0 (then H0 holds even with a checker, and the program ends — see Kill Criteria).
**Cost:** offline re-emit + replay ≈ 1 worker pass on 16–40 aec instances (~$ low; aec attempts are short, not the 3hr finsearch GEPA). The single most decisive experiment in the plan.

### H3 — Conformal abstention is calibrated on the exchangeable corpus (offline; the PRODUCT)
**Claim:** Split-conformal selective prediction over the committed corpus yields a valid risk-coverage curve, enabling calibrated *I-don't-know* at a target error rate — independent of whether structure beats blind.
**Prediction:** Empirical error at coverage c ≤ nominal α within bootstrap CI; abstention concentrates on the unsolved band.
**Experiment (offline):** Hold out a calibration split of finsearch.jsonl; fit conformal threshold on a self-consistency score; measure risk-coverage on the test split with paired bootstrap.
**Decision rule:** Ship if error ≤ α at ≥ a useful coverage (e.g. ≥ 60% answered at ≤ 10% error); else report the coverage/error frontier as the product's honest envelope.
**Cost:** offline, hours of engineering, zero rollout. **This is the deployable-today deliverable.**

### H4 — Stream-drop is not missing-at-random (offline diagnostic; validity gate for ALL live arms)
**Claim:** The ~14% finsearch-over-sandbox stream-drop correlates with stream size/concurrency, so the corpus denominator is biased and paired-bootstrap validity is at risk until A5 (content-addressed dedup) lands.
**Prediction:** infra-errored/dropped instances are non-uniform in output length or concurrency bucket.
**Experiment (offline):** regress drop indicator on stream length + concurrency over existing run logs; test MAR.
**Decision rule:** If non-MAR, **no live gate result is admissible until A5 merges** — fix-then-run; if MAR, live arms proceed.
**Cost:** offline, low. **Blocks H2(b) and is the honest reason the keystone live gate is "unrun" — infra, not concept.**

### H5 — More-compute (random@k vs blind) is a real but modest effect (offline confirmatory; bounds the ceiling)
**Claim:** `random@k − blind > 0` (the pure compute effect) is positive but small and not the missing win.
**Result (measured this session):** finsearch random@k 53.3% vs blind 43.1% = **+10.2pp** (was reported n.s. at n=40; n=51 here); aec-diverse random@k 34.4% vs blind 25.0% = +9.4pp. **Confirmed positive, modest.** The headroom is in selection (oracle−selector 17.6pp finsearch / 25pp aec), not in more samples.
**Cost:** done.

**Explicitly NOT proposed (settled-negative; CLAUDE.md forbids re-running):** within-run steering (rung-0 refine-hand −10pp, refine-gepa −15pp, n=40). Do not re-open.

---

## 4. Roadmap (phased, gate-disciplined)

**Phase 0 — Lock the negatives, publish the instrument (now, offline).** Freeze the gen-6 corpus. Write up H0/H1/H5 as the headline finding: *deployable selection loses to blind on both a judge domain and a checker domain; diversity raises the ceiling but self-consistency can't capture it.* This is the moat artifact.

**Phase 1 — Ship the abstention product (H3).** Conformal selective prediction over the corpus + conserved pool. Deployable to the fleet without any positive gate. Highest-ROI, lowest-risk work in the program.

**Phase 2 — Fix rollout, then fire the one decisive experiment (H4 → H2).** Land A5 (content-addressed dedup); run the MAR diagnostic; only then run the checker-scored selector on aec-diverse. This is the legitimate next science — verifier-grounded, on shipped infra, attacking the measured −9.4pp.

**Phase 3 — Gated, conditional only.** Per-branch adaptivity, learned planners, the belief learner, the outer flywheel: **build none of it until H2 returns BH-significant positive.** If H2 is positive, the learner tier is then *essential and ready* — and correctly named "amortized search against a checker."

**STOP building immediately:** belief-state learner (no signal to bind — its own spec admits this); learned-planner producer for `PlannerContext.analyses` (typed wire with no consumer); any new combinator/topology op (expressiveness is not the bottleneck — `corpus-replay` proved selection is); any re-run of within-run steering.

**Off-ramp if H0 holds (the most likely outcome on text channels):** pivot fully to *instrument-as-product*. Sell (a) the equal-k confound-free measurement harness as a service for evaluating agent-orchestration claims, (b) the conformal abstention product (H3), and (c) the synthesis-verifier harness as the *one* domain where topology demonstrably helps (the aec oracle ceiling). Retire the recursive-self-improvement framing entirely.

---

## 5. Is agent-runtime good experimental infrastructure?

**Layered verdict:**

- **Measurement — EXCELLENT.** Equal-k by construction (atomic reserve/refund, not by post-hoc balancing), deterministic seq-replay over a content-addressed journal, paired bootstrap + BH with infra-error exclusion (`corpus-report.mts:376`). The −8.2/−9.4pp negatives are credible *because* the apparatus is confound-resistant. This is the rare thing.
- **Analysis — EXCELLENT.** Selector≠judge firewall enforced at the module boundary (`assertTraceDerivedFindings`); offline `corpus-replay --selector` reproduces the gate in seconds with zero new calls. I reran the entire gate during this analysis from disk — that reproducibility is the proof.
- **Live rollout — POOR (the binding weakness).** The live gate timed out twice; finsearch-over-sandbox hung ~1hr at ~14% stream-drop. If drops aren't missing-at-random the corpus denominator is unstable and bootstrap validity is at risk. Content-addressed dedup (A5) is identified but unmerged.

**Fix vs sidestep:** **Sidestep for science, fix for product.** The science (H0/H1/H2) runs offline on the committed corpus and needs no reliable rollout — sidestep it. The product and any *new* live arm (H2b) need A5 + the MAR diagnostic (H4) — fix it, and treat any live gate number as inadmissible until then.

**One sentence:** *agent-runtime is a precise, confound-resistant instrument for measuring and analyzing orchestration claims and an unreliable engine for producing them at scale — so run the science offline where it is already excellent, fix rollout (A5) before trusting any live number, and stop mistaking the instrument's completeness for readiness to self-improve.*

---

## 6. Kill Criteria (so the program can be honestly ended, not perpetually deferred)

The RSI/orchestration program is **STOPPED — not deferred** if:

1. **H2 returns ≤ 0, BH-corrected, at n≥30 on aec-diverse.** If a *verifier-grounded* selector cannot beat blind even on a domain with a runnable checker and a 25pp oracle ceiling, then selection is unrecoverable and there is no win to chase. Retire the orchestration thesis; keep the instrument + abstention product.
2. **H0 confirmed across the full selector sweep** (every deployable selector × topology ≤ 0, BH-significant or null, n≥40 on both corpora). The thesis "structure beats blind on text channels" is falsified; execute the Phase-0 off-ramp.
3. **Any proposal to build the belief learner, learned planner, or flywheel before a positive H2** is an automatic stop — it is the #141 anti-pattern (mechanism with zero metric movement) repeated, and CLAUDE.md forbids it.
4. **H4 shows non-MAR drop AND A5 cannot stabilize the denominator** — then no live gate is ever admissible; the program reduces to its offline instrument and product, and the live-rollout science is killed (not paused).

**What is NOT a kill signal (so the negatives aren't misread):** another offline negative selector result *is the product working*, not the program failing. The instrument earning credible negatives is the success condition for intents 2 and 5 even as it falsifies intent 1.
