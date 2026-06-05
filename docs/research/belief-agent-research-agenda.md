> **Track:** Architecture (research) · **Role:** research agenda for the recursive/belief-state agent · **Status:** top tier is OFFLINE on committed corpora (no sandbox); learner tier gated on a positive gate

<!-- Source: workflow wmzhyr5bg — 7 disciplinary lenses → adversarial slop-filter → ranked agenda. Grounded against the gate result (judge-blind selection loses: finsearch -8.2pp n=51, aec -9.4pp n=16; diversity opens a 50% oracle ceiling; the win needs a DEPLOYABLE CHECKER). Cross-links: belief-state-learner-spec.md, architecture-alternatives.md, aec-bench-gate-result (memory). -->

I have everything I need — the analysis is complete and every claim is already grounded against the verified substrate facts. Writing the agenda now.

# A Research Agenda for the Recursive Agent Atom: Selection Under a Verifier-Blind Channel

**Binding fact this whole agenda answers to:** a deployable, judge-blind selector (self-consistency) *loses* to a blind draw — finsearch −8.2pp (n=51), aec-bench −9.4pp (n=16) — yet diversity opens a large oracle ceiling (aec 50.0% vs ~2.5% floor). The bottleneck is **selection, not generation**, and the win is recoverable only where a **deployable checker** (a verifier the agent runs without the gold) exists. The trace→calibrated-confidence map has **no producer** (belief-spec L65; H1–H5 are synthetic-sim only). Everything below is ranked against those facts. Nothing in the top tier needs a new rollout.

---

## 1. Alternative characterizations (the reframes that unlock the most)

**C1 — The −8.2pp is an *estimator* failure, not a *controller* failure (separation principle).**
*Imports:* certainty-equivalence control; MAP estimation under an explicit likelihood; the known correlated-error/herding failure of self-consistency.
*Enables:* a precise, falsifiable decomposition — self-consistency is MAP over a likelihood that assumes conditionally-independent errors; on finsearch that assumption is false, so the vote's mode is anti-correlated with truth and MAP underperforms a uniform draw. This is the theory that *predicts* text-only selection cannot beat blind on finsearch, and that routes all real ceiling-recovery into channels with an **independent recheck** (tests, citation re-fetch). It is load-bearing precisely because its own corollary kills the fancier-text-likelihood proposals.

**C2 — The agent atom is a *selective predictor*, not a best-of-N picker.**
*Imports:* split-conformal / conformal risk control (Vovk; Angelopoulos–Bates) — distribution-free coverage from exchangeability alone.
*Enables:* reframes the commit-loss as the symptom of *being forced to answer with no signal*. The firewalled `Selector = (outputs) => number` widens to `(outputs) => index | ABSTAIN` with a coverage bound calibrated on the corpus's stored `valid`. Maps verbatim to the operator fleet's abstention requirement. Sidesteps the unsolved trace→confidence crux because conformal needs only an exchangeable calibration set, which the committed corpora already are.

**C3 — The corpus is an off-policy replay buffer; the gate is off-policy policy evaluation.**
*Imports:* per-decision IPS / SNIPS / doubly-robust OPE for contextual bandits (Dudík/Jiang/Li) + ESS diagnostics.
*Enables:* `selector@k vs random@k` becomes the *value* of a target policy over a logged behavior policy, estimable **over an entire selector class with no new rollouts**. Turns the gate from a single binary into a cheap screening instrument — the right way to vet C2 and any future selector before building it.

**C4 — A total cheap verifier collapses the POMDP to an MDP (the tie-break, formalized).**
*Imports:* the noiseless-observation limit of the separation principle; execution-guided synthesis (CodeT/AlphaCode/LEVER).
*Enables:* with a total deterministic verifier the belief over "is this correct" is a delta, `select = pick-any-passing` is provably optimal, and the −8.2pp failure *cannot occur*. This is `architecture-alternatives.md` L35 ("flips to *replace* the day a domain acquires a total cheap verifier") stated as an identifiability condition — and it is the only regime where the belief machinery, QD, and mechanism growth earn their keep.

---

## 2. Applications ranked (highest leverage first)

| # | Application | Fleet? | Verifier? | Status |
|---|---|---|---|---|
| A1 | **Conformal answer-or-abstain selector** — coverage-guaranteed `index \| ABSTAIN` over the firewalled `Selector`, calibrated on stored `valid`. (C2; merges stats#1 + causal#1 + product#1 + MBR.) | ✅ operator fleet (abstention IS the product) | partial (uses disagreement only) | **build-now, offline** |
| A2 | **Program-synthesis LeafExecutor** — diverse proposals, selection by **runnable tests**, deterministic completion as the selector. The regime where separation provably holds. (C4; merges control#4 + RL#3 + causal#3.) | ✗ narrow (most operator domains lack a total verifier) | ✅ total cheap | **build-now; the run is the deliverable** |
| A3 | **Provenance citation-survival as a *partial* deployable verifier** — rank k by fraction of cited authorities that survive an independent non-LLM re-fetch+entailment check (G-STEAL-1 refuter pointed at citation fidelity). (merges product#2 + DB#2 + causal#2.) | ✅ tax/legal/insurance | partial (citation layer only) | **research; mechanism build-now, gate arm needs a gold slice** |
| A4 | **Surprisingly-Popular / BTS aggregator** — pick the answer whose actual frequency beats its predicted frequency; Bayes-optimal in the correlated-error regime that breaks plurality vote. (econ#1.) | partial | ✗ | **build-now, offline; contingent on R2's diagnosis** |
| A5 | **Exactly-once outRef-dedup of the gate denominator** — dedup attempts by content-addressed `outRef` before counting k, so the ~14% finsearch stream-drop stops inflating self-consistency clusters. (DB#4.) | n/a (plumbing) | n/a | **build-now; enables a clean keystone** |

**Gated (do not build now):** SRE-RCA QD+verifier *replace* (highest commitment; telemetry "verifier" is total over the observation window, not over causality — gated on A2 proving diverse@k+verifier beats blind on aec). Loss-aware VoI stopping (right object for operator abstention, but downstream of the unsolved calibration extractor — build after R1/R2 produce a calibrated signal). Corpus independence-clustering (do the one-line `evidence?`→required schema fix + measure the dup ratio now; defer the pipeline until dup ratio ≫ 1.0).

---

## 3. Research directions ranked

Each: named method · substrate hook · status · the one decisive experiment. Top tier is offline on committed corpora — the correct first spend before the blocked sandbox keystone.

**R1 — Conformal selective prediction.** *(C2)*
Method: split-conformal / conformal risk control; **Mondrian/group-conformal** for cross-tenant drift (or the guarantee is fiction). Hook: `selector.ts` (already firewalled) → add `ABSTAIN` return + a coverage/abstain column to `summarizeSelector`; calibrate on the committed corpus's `valid`. Status: **build-now, offline.**
*Experiment:* at α=0.05 on `finsearch.jsonl`, what is the answer-rate, and is answered-accuracy > random@k at matched answer-rate? **Honest likely outcome:** high abstain-rate, flat answered-accuracy — which is itself the decision (finsearch has no deployable signal; the product value is the calibrated I-don't-know rate). Decision rule: if auto-resolve coverage < human-triage baseline, kill the product wiring.

**R2 — OPE of the selector *class* over the corpus-as-replay-buffer.** *(C3)*
Method: SNIPS / doubly-robust per-decision IPS + ESS. Hook: extend `scoreSelectorOnRun` to a weighted estimator over a selector class. Status: **build-now, offline.** This is the *instrument* that screens R1 and any future selector cheaply.
*Experiment:* estimate the value+CI of the whole firewalled-selector class on **aec-diverse** (where cluster structure is non-trivial), *not* finsearch (the homogeneous slice will faithfully estimate ~random).

**R3 — The −8.2pp as MAP under a degenerate i.i.d.-error likelihood.** *(C1)*
Method: correlated-error / separation-principle decomposition. Hook: offline statistic over the committed corpora. Status: **build-now, offline.**
*Experiment:* compute the inter-attempt error-correlation statistic over finsearch + aec; confirm errors are correlated (modal cluster anti-correlated with truth). **Bounded value, stated honestly:** a fancier likelihood over candidate *text alone* is self-consistency with extra steps — this diagnosis is load-bearing only where an independent recheck channel exists, i.e. it justifies R5/A2/A3, not a text-only fix.

**R4 — Program-synthesis verifier run (the existence proof at scale).** *(C4)*
Method: execution-guided selection; paired-bootstrap + BH at significant n. Hook: `LeafExecutor` open registry + `in-process-executor.ts` (worktree+testCmd) + `deterministicCompletion`. Status: **build-now; the run is the deliverable.**
*Experiment:* diverse@k-with-tests on aec at significant n. **Three load-bearing caveats:** (a) the win is *narrow* — does not generalize to the fleet ("validates concept ≠ validates product"); (b) **reward-hacking** — test-author ≠ code-author or hold out hidden tests, or "all green" is a fake reward; (c) **the anticorrelation threat** (pinned here from the killed do-calculus direction): `driver-layer-zero-headroom-coding` found SWE oracle headroom ~0pp — if the inner agent self-corrects to its verifier within one rollout, there is no diversity ceiling to recover *on exactly the domain where the verifier is sound*. aec-diverse (oracle 50% vs random@k 34.4%, n=16) is the existence proof that on a synthesis-adjacent domain the ceiling is real, but n is tiny — this run is to convert theory to measurement.

**R5 — Surprisingly-Popular aggregator.** *(A4, econ#1)*
Method: Prelec surprisingly-popular / Bayesian Truth Serum (the unique info-truthful proper scoring rule). Hook: each attempt emits a meta-prediction; scored offline through `summarizeSelector`, firewall-clean. Status: **build-now, offline; downstream of R3.**
*Experiment:* run only if R3 confirms correlated errors AND answers discretize (note `normalizeAnswer` cannot cluster paraphrases — the selector's documented ceiling). Then SP is the highest-upside *text-domain* selector to try.

**R6 — Citation-survival as a partial verifier for operator products.** *(A3)*
Method: G-STEAL-1 `{producer, refuter}` panel + non-LLM re-fetch/entailment leaf; `assertTraceDerivedFindings` admits the recheck. Hook: `LeafExecutor` leaf + `CompletionEvidence`. Status: **research (gate arm blocked on a gold slice); mechanism build-now.**
*Experiment:* on a gold-labeled operator slice, does citation-survival@k rank *correct* above *incorrect*, or only *well-cited* above *sloppy*? If the latter, it is provenance theater that gives false confidence on exactly the high-stakes errors that matter. **No gold slice exists — that is the blocking dependency.**

**R7 — Exactly-once dedup of the denominator.** *(A5, DB#4)*
Method: idempotent-consumer / fencing by content-addressed `outRef` + `(sessionId, seq)`. Hook: `spawn-journal.ts` (observed-committed appends, content-address = dedupe key) + `assertSessionLive` + bench equal-k accounting. Status: **build-now.** Not a win — plumbing for a trustworthy keystone. If drops are MCAR it flips no verdict, only tightens n/CIs; build it because the keystone is blocked partly on stream reliability and a contaminated denominator invalidates the result.

---

## 4. The slop graveyard (killed — do not re-propose)

1. **EIG-widening / Bayesian optimal experimental design for `promising()`** — needs `p(output | lens)`; calibration is the documented unsolved problem (L65). Its cheaper baseline (sample k distinct lenses uniformly) *is already the untested diverse arm*. Mechanism ahead of the gate.
2. **SPRT / anytime-valid completion stop** — needs a calibrated per-sample likelihood ratio; without it, degenerates to "spawn until budget drains." A cost/abstention win at best; more-attempts is n.s. on finsearch. (Durable bit — *stop is downstream of calibration* — folded into R1/R3.)
3. **Minimum-Bayes-risk / Chow's-rule selection** — conformal abstention (R1) with extra vocabulary. Redundant.
4. **Reward-model audit of the analyst** — the *same* measurement as the AUC/calibration check (R1/R3). De-duplicated; keep only its BH-pre-registration discipline.
5. **Calibrate trace→posterior before the belief engine** — identical to R1/R3 (AUROC of trace features vs `valid` + isotonic recal). Merged.
6. **Anytime-valid e-process corpus promotion** — pure mechanism ahead of the gate; *nothing is worth promoting yet*. Fixed-n bootstrap+BH suffices until a candidate beats blind.
7. **MVCC / bitemporal corpus characterization** — vocabulary reskin of correlated-error (already C1/R3 with a concrete fix); predicts nothing the estimator framing doesn't.
8. **Sequential Halving over strategy-arms at equal k** — needs a cheap mid-rollout proxy, but the only deployable mid-run signal (self-consistency/steer) *loses*; halving on a bad proxy is strictly worse than uniform and kills the minority-correct arm early. Forbidden until diverse@k is positive AND a trustworthy early-proxy exists.
9. **do-calculus identification of the verifier regime** — its operational content *is* R4 (run diverse@k on a test-verifiable bench); the Pearl wrapper adds no build/measurement. Its real finding (the verifier↔ceiling anticorrelation threat) is folded into R4 as a pre-registered risk.
10. **RV-LTL / temporal-logic completion monitor** — for high-value domains the useful spec ("answer is correct") is not monitorable without the gold; only structural specs are decidable, and the structural↔correctness correlation check is already R6. The 3-valued framing renames the existing deterministic/probabilistic split.

*Demoted, alive, gated (not killed):* SRE-RCA QD+verifier replace; counterfactual-replay credit assignment (premised on bit-deterministic sandbox replay, which is **not established**; rung-0 already settled within-run-steer loses on finsearch); loss-aware VoI stopping; corpus independence-clustering pipeline.

---

## 5. The thesis line

**Judge-blind selection cannot beat blind compute on a text-only channel — so this program pays off exactly where the agent can run a verifier without the gold: it ships *calibrated abstention* to the operator fleet (R1) and recovers the diversity ceiling *only* in deployable-checker domains — program synthesis with runnable tests (R4) and re-checkable provenance (R6) — with everything that assumed text-observable signal the corpus does not contain consigned to the graveyard.**
