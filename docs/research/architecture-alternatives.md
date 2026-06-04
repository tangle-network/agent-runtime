# Architecture Alternatives — Five Paradigms vs the Recursive-Atom Tree

**Audience:** lead engineer + operator. **Question this decides:** is the shipped recursive-atom tree the right substrate for "one agent spawns many loops to accomplish complex roles on *any* unsolved problem," or must a paradigm replace it?

**Provenance:** verified against `recursive-execution-atom.md` (Scope/Supervisor/Journal contract at lines 178–283, build steps 2–8), `observed-orchestration-patterns.md`, `.evolve/current.json` (gate state, gen 6, the unrun keystone), and the shipped code (`src/loops/personify/analyst.ts:47` = the `assertTraceDerivedFindings` firewall; `src/loops/run-loop.ts:881` = `defaultSelectWinner`; `bench/src/corpus.ts:251` = `appendRunRecord`, append-only; `bench/src/diverse-gate.mjs` = the gate in one command). Five steelmanned paradigm analyses (blackboard, compute-market, active-inference, evolutionary/QD, Gödel-machine, debate) and the adversarial cross-comparison are the inputs; this doc is the decision.

---

## 1. VERDICT

**Keep the recursive-atom tree as the spine. Graft six ideas onto named seams. Do not replace.**

This is not a hedge — it is the only verdict the evidence supports, and it survives the sharpest case against it. The reasoning, in one chain:

**The tree is the only design that can run the experiment that decides everything else.** The repo's binding question is the gate: *does any non-blind topology beat blind compute at equal k, under a deployable (non-oracle) selector, at significant n?* Answering it requires four properties simultaneously: conserved budget so `Σk(treatment) ≡ Σk(blind)` *by construction* (`recursive-execution-atom.md:178`, atomic reserve / fail-closed / refund), deterministic replay so paired-bootstrap + BH have a stable instrument (content-addressed `outRef` + seq-ordered `SpawnJournal`, :179), single-owner legibility so an operator can read *why a node spawned*, and the `selector≠judge` firewall so a measured win isn't judge-leakage (`assertTraceDerivedFindings`). The tree was engineered around exactly these four. **Every challenger scores 1 or 2 on cost-control and buildability** — they were engineered around expressiveness, not instrument-validity.

**The challengers converge on "graft" for a structural reason, not out of reviewer self-protection.** Each wins on exactly *one* axis — and it is, in every case, an axis the incumbent already named as a gap (G2 missing Corpus, the undefined `promising()` in progressive-widening, fixed-mechanism self-critiques d+e). Each loses on the *four* axes the incumbent guarantees. A 1-vs-4 pattern repeated across five independent paradigms is the signature of a substrate with the right decomposition: the six grafts land on *six distinct seams without colliding with each other*. A wrong spine would force them into mutually-exclusive rewrites; this one absorbs all six additively.

**The strongest replace-argument fails on one empirical fact.** The sharpest case for replacement (adopt QD+verifier, FunSearch-lineage, as the spine; it has *published positive results* on open math while the incumbent has *only negatives*) is real and must be respected — but it smuggles in the assumption that a **total, cheap, deterministic verifier** exists for the target domains. FunSearch/AlphaEvolve are not evidence that population-search beats the tree on the BAR; they are evidence that *QD beats everything once you already possess the sound verifier the incumbent correctly flags as the actual bottleneck*. On the commercial domains the BAR names as hard — open business, open creative, research-with-LLM-judge — no total checker exists, and every replace-candidate degrades to "LLM vibe wearing a Bayesian/economic/evolutionary costume" (the findings concede this in their own words). The repo's measured reality — 0 coding headroom, negative finsearch steering, deployable selector −8.2pp — *is the "no-total-checker" world*. In that world the tree's negatives are **true**, and the challengers' generality is **fabricated signal** — the exact confounded-compute failure the repo was burned by once (the "+20pp steering proven" that was 3× compute + infra drops + untested judge) and built this instrument to forbid.

**The decision matrix, compressed** (5 = native strength, 1 = structural failure; generality split math/business/creative because it is domain-conditional):

| Paradigm | Generality (M/B/C) | Verifiability | Cost/budget | Legibility | Buildable NOW | Self-improve ceiling |
|---|---|---|---|---|---|---|
| **Incumbent: recursive-atom tree** | 3/3/3 | 3 | **5** | **5** | **5** | 2 |
| Blackboard / Society-of-Mind | 4/4/5 | 2 | 1 | 2 | 1 | 3 |
| Compute-Market / Economic | 3/5/4 | 1 | 2 | 2 | 2 | 4 |
| Active-Inference / Free-Energy | 3/4/2 | 2 | 2 | 1 | 1 | 3 |
| Evolutionary / QD-Archive | 5/3/5 | 1 | 2 | 2 | 2 | 4 |
| Self-Rewriting / Gödel-Machine | 4/2/3 | 3 | 1 | 1 | 1 | **5** |
| Debate / Dialectic | 4/4/2 | 3 | 2 | 2 | 3 | 3 |

The incumbent is *mediocre on generality + self-improvement, maximal on the three engineering axes that make the science valid*. No challenger dominates it across the board; each dominates on a disjoint axis. That is the mathematical statement of "graft, don't replace."

**Tie-break rule, written down so the next agent doesn't relitigate this:** the verdict flips to *replace* the day a target domain acquires a total, cheap, deterministic verifier (formal math, code-with-tests, spec-checkable artifacts). In that world the incumbent's verifiability-honest posture becomes needless caution and its conserved-budget instrument becomes overhead on a problem that has ground truth — adopt QD+verifier or Gödel-proof-gating as the *substrate* for that domain, not a graft. Until then, the tree is the spine.

---

## 2. WHAT TO STEAL — the grafts, ranked

Ranked by (decisiveness against the open gap) × (cheapness onto the shipped surface) ÷ (mechanism-ahead-of-gate risk). Every graft below preserves the four load-bearing invariants (conserved budget, deterministic replay, single-owner legibility, `selector≠judge`). Each names the self-critique it closes: **(a)** task-shaped Outcome, **(b)** sibling-sharing only through the parent, **(c)** verifiability is the real bound, **(d)** mechanism is fixed code, **(e)** allocation is hand-written not learned.

### G-STEAL-1 — Incentivized refuter as a selection signal *(from Debate)* — **DO FIRST**
- **What it changes:** today `verify`/`panel` re-inspects an artifact and the deployable selector ranks on self-consistency — which *loses* (−8.2pp). Add a second `verify` role with an **asymmetric contract**: it is rewarded only for *localizing a concrete, independently-checkable defect* (cite the exact `file:line` / proof-step / assumption that breaks). The selector then ranks on "survived the refuter," not "is self-consistent."
- **How cheaply it grafts:** one new `AgentProfile` (the refuter persona) + a `{producer, refuter}` panel feeding the existing `Validator`/`DefaultVerdict`. The refuter's finding is written to the `SpawnJournal` as an ordinary `Settled.verdict`. Cost is bounded — *one extra child per candidate* (k → k+1), not a divergent K-round debate tree. Stays inside the firewall because the refuter emits a **trace-derived defect**, not a quality score (`assertTraceDerivedFindings` is exactly the gate that admits it).
- **Closes:** (c) — it is the *only* graft whose core primitive is "extract more signal from a bounded verifier," which is the open bottleneck. Partially closes (a) via the contested-defect ledger.
- **Why first:** it is the cheapest available *direct shot at the −8.2pp loss*, and it is a clean gate arm runnable on the committed finsearch corpus today: *does refuter-survival selection beat self-consistency at equal k?*

### G-STEAL-2 — Open-pursuit terminal contract `Outcome { solved | blocked | progress(frontier, confidence) }` *(from Active-Inference + Debate + QD, convergent)* — **DO SECOND**
- **What it changes:** `SupervisedResult` is `{ winner | no-winner }` and `Outcome` is `{ done | blocked }` — both task-shaped. Open problems are never done; they have current-best + frontier + per-node confidence. Add a third terminal variant `progress(frontier, confidence)` and a confidence-based stop (a `ΔEFE<ε`-style "expected gain from further spawning drops below cost"). Typed, additive to `SupervisedResult` — no change to the budget machine.
- **How cheaply it grafts:** a discriminated-union extension on the existing terminal type + a driver-side stop predicate. The budget pool still drains and the Supervisor still joins; `progress` is just the *non-terminal* result the join surfaces when the pool empties without a `solved`.
- **Closes:** (a) directly. This is the single most-agreed graft across all five findings — three paradigms independently named it.
- **Critical caveat (steelman the replace-case here):** the replace-argument's deepest point is that "no terminus" cannot be patched onto a machine whose keystone (draining pool + join barrier) *assumes* termination. The rebuttal is that the pool draining is a *budget* terminus, not a *problem* terminus — `progress` is precisely "budget exhausted, problem open," which the conserved pool already produces as `no-winner: budget-exhausted` (`recursive-execution-atom.md:245`). We are *renaming and enriching an existing terminal state*, not bolting non-termination onto a terminating machine. If integration reveals the join barrier genuinely cannot represent a resumable frontier, that is the signal to escalate — but the shipped `no-winner` typing says it can.

### G-STEAL-3 — Quality-diversity archive as the shape of the cross-run Corpus (G2) *(from Evolutionary/QD; also the blackboard's "board as memory")* — **DO WITH G2**
- **What it changes:** the Corpus is currently `appendRunRecord` — a flat append-log (`bench/src/corpus.ts:251`). Make it a **MAP-Elites archive**: `insert(record)` conditional on `descriptor(record)`'s cell — `keepIfBetterInNiche(descriptor, fitness)` instead of `append`. The next run's root `act` reads a *diverse seed set* ("best-known approach per niche") instead of one global best.
- **How cheaply it grafts:** three wirings onto existing seams. (i) the descriptor is computed from data the trace already carries (which §1 shape ran, profile/persona, problem sub-type, trace length) — no new capture; (ii) `defaultSelectWinner` (`src/loops/run-loop.ts:881`) already does best-valid-score-ties-earliest, so per-niche selection is the *same comparator scoped to a cell* — a tiny generalization, not a new selector; (iii) the firewall is preserved because insertion ranks on the deployable selector / trace-derived findings, never the write-only judge.
- **Closes:** (b) — a shared archive is a blackboard siblings read directly, dissolving "insight only through the parent." (e) — turns "spawn diverse strategies" from an ad-hoc per-run driver choice into a *learned, persistent seed bank*. Partially (a) — the archive's coverage×quality *is* the frontier+confidence object.
- **Why this is the highest-leverage memory decision:** all five grafts ultimately read or write the Corpus. The replace-case's sharpest jab is that "every graft secretly needs an unbuilt Corpus, therefore the archive is the real spine and the tree is a leaf." The rebuttal is decisive: the Corpus is a **node in the tree's already-shipped storage spine** (`ResultBlobStore` content-addressed put/get + `SpawnJournal` append-only seq-log), it inherits the tree's three invariants *for free* (conserved — Supervisor stays sole budget owner; replayable — rides the seq journal; firewalled — `assertTraceDerivedFindings`), and an *opportunistic controller over a mutable shared store is the single hardest thing to make deterministically replayable* (concurrent sandboxed writers, write-write conflicts, nondeterministic trigger order). The board is a superior *memory* substrate and a fatal *control* substrate. **Build the archive as memory the tree reads — never as the controller.**

### G-STEAL-4 — Epistemic-value (corpus-distance) widening signal *(from Active-Inference)*
- **What it changes:** progressive-widening's `promising()` is undefined (`recursive-execution-atom.md:61, 266`), and reading it off the verdict *is* steering-from-the-judge (R2, :275). Replace it with a **structural, judge-free** score: widen where a branch's settled results are most *divergent / least-redundant* against siblings already in the Corpus (predicted information gain ≈ novelty-vs-corpus + sibling-disagreement). Never reads `verdict.score`.
- **How cheaply it grafts:** a function over `ResultBlobStore` + the Corpus (embedding/structural distance) computed at `scope.next()` time, feeding the existing `WidenGate`. No generative model, no variational inference — only the *epistemic term*, not the free-energy machinery.
- **Closes:** (d) partially — the operator set gains a principled, firewall-clean widening rule. It also *operationalizes the open gate itself*: an epistemic widen-gate is the principled implementation of "diverse strategies," giving the gate run a real treatment arm instead of random widening.
- **Sequencing:** depends on G-STEAL-3 (needs the archive to measure distance against). Lands with or just after the Corpus.

### G-STEAL-5 — Shadow-price admission (scarcity-aware widening) *(from Compute-Market)*
- **What it changes:** `scope.spawn` currently reserves "if it fits" (fail-closed admission). Add one derived quantity to the budget pool — a **shadow price** that rises as `free` shrinks toward zero — and change admission from "fits?" to "worth it at the current price?" (reserve iff the spawner's declared expected-value-per-token exceeds the shadow price). This is a principled replacement for the magic progressive-widening `THRESH` constant.
- **How cheaply it grafts:** one field on `SpawnOpts` (`bidValuePerToken`, which the driver already implicitly has when it decides to widen) + a ~20-line change to `BudgetPool.reserve`. **Does not touch equal-k accounting** — the pool stays conserved; only the admission *test* changes. The shadow price is recorded as one number per spawn decision in the `SpawnJournal`, so it stays legible and replayable.
- **Closes:** (e) partially — scarcity-aware admission is a learned-ish allocation discipline. Implements MCTS progressive-widening's intent with a principled dual variable instead of a constant.
- **Reject the rest of the market:** no clearing auction (breaks per-arm equal-k), no bucket-brigade backward credit until the Corpus exists *and* the gate is green (backward credit is the learned allocator = mechanism ahead of the gate; it lands later as "the price a winning `outRef` earns when a downstream run consumes it," writing into the archive G-STEAL-3 builds).

### G-STEAL-6 — Proof-gated mechanism growth: `proposeMechanism` / `admitMechanism` *(from Gödel-Machine)* — **DEFER UNTIL GATE IS GREEN**
- **What it changes:** combinators (`pipeline/fanout/loopUntil/panel/verify/widen`) are a fixed closed set. Add a `proposeMechanism` move that lets a driver emit a *new* Program subtree (a candidate combinator, expressed in the existing op-set so it stays legible) tagged with a `utilityClaim`, plus an `admitMechanism(claim)` gate that runs it as a **shadow branch under the same Scope, on the same tasks, at equal k**, and promotes it into the reusable set only if its delta clears an anytime-valid held-out test on the Corpus.
- **How cheaply it grafts:** nearly free *because every dependency already shipped* — the Scope does atomic reservation (shadow branch conserved by construction), the `SpawnJournal` content-addresses results (shadow run replayable), the Corpus stores `RunRecord`s for paired-bootstrap+BH, the firewall keeps the utility test off the judge, and the **held-out gate already exists at the optimization timescale** (`heldOutGate`). The "Gödel proof" becomes "shadow-run + held-out gate" — the *existing* gate re-pointed from the worker's prompt to *the driver's own operator set*.
- **Closes:** (d) AND (e) together — mechanism becomes improvable, allocation becomes learned. Highest self-improvement ceiling of any graft.
- **Why deferred:** this is the textbook "mechanism ahead of the gate." Building the highest-ceiling, least-buildable extension to escape the open gate — *before* the one cheap decisive measurement (`diverse-gate.mjs`) — is the repo's named anti-pattern. It is the natural extension of the missing wire (`architecture-interpretations.md`: "RSI only if findings about which move paid off rewrite the driver's policy"), and it lands *the day after* a positive gate, not before.

**Reject as substrates (the controllers, not the ideas):** opportunistic blackboard scheduling (no budget owner, nondeterministic replay), the clearing auction + bucket-brigade (breaks equal-k, needs millions of episodes), the variational free-energy core (uncomputable in TS-on-flaky-sandboxes, presupposes the calibrated signal that is the bottleneck), the free-running population (win regime = millions of cheap verifiable evals = the inverse of this stack), the literal Gödel kernel rewrite (no buildable admission proof, hostile to the reproducible corpus), and the full recursive-debate executor (divergent cost, needs a calibrated referee the gate evidence says we lack).

---

## 3. THE NORTH STAR

**"General" means two things, and the build order depends on naming which one is the target.**

- **General-1 — "run any task":** one agent spawns the right loops/shapes to *accomplish* an arbitrary role. This is the BAR's literal phrasing.
- **General-2 — "improve its own ability to run any task":** the agent gets *better at choosing what to spawn* across runs — a learning flywheel over its own mechanism.

**Honest position: General-2 is the actual north star, and General-1 is already substantially shipped.** The kernel proved this itself: `#141 runProgram` shipped full topological expressiveness and *moved no metric, by design* — which is the cleanest possible evidence that **expressiveness was never the bottleneck**. The agent can already express any topology. What it cannot do is *know which topology is worth spawning* (the open gate) or *learn that across runs* (self-critiques d+e, the fixed mechanism). General-1 is a solved expressiveness problem sitting on an *unsolved evidentiary* problem.

**What this implies for build order — the load-bearing consequence:**

1. **General-2 is gated on verifiability, not orchestration.** You cannot learn to allocate better without a signal that says which allocation paid off. The measured signal *loses* (−8.2pp). So the first dollar of General-2 work goes to the *signal* (G-STEAL-1, the refuter), not to the *learner* (G-STEAL-6, mechanism growth). Build the thermometer before the thermostat.
2. **The Corpus (G2) is the spine of General-2, because cross-run learning has nowhere to live without it.** Every learned-allocation graft (3, 4, 5, 6) reads or writes it. This makes the QD-archive Corpus (G-STEAL-3) the *enabling* graft — the one that converts a pile of single-run trees into a flywheel.
3. **Do not build the learner ahead of proof that the signal exists.** General-2's payoff is conditional on the gate. The discipline is not a deadlock (the replace-case's sharpest jab) — it is the correct *ordering* for an evidentiary problem: the gap that's closed is expressiveness; the gap that's open is whether *any* non-blind signal beats blind compute, and that is **one un-run command** from an answer, not one substrate-rewrite away.

The north star, stated for the next agent: *we are building an agent that learns to allocate its own compute across runs (General-2), on a spine that already runs any task (General-1), and the binding constraint between here and there is a calibrated, deployable, non-judge signal — which the gate measures and the refuter graft attacks.*

---

## 4. WHAT NOT TO CHANGE

Resist novelty-for-its-own-sake. These are where the incumbent is genuinely best and changing them destroys the thing that makes the work *checkable*.

- **The conserved-budget Scope (atomic reserve / fail-closed / refund).** This is the moat. `Σk(treatment) ≡ Σk(blind)` *by construction* is what makes the gate valid and what every challenger fails to replicate. Do not let any graft re-allocate budget outside the pool (this is why the clearing auction and free-running population are rejected). The shadow-price graft (G-STEAL-5) is admitted *only* because it changes the admission test without touching the conserved accounting.
- **Deterministic seq-ordered replay (`SpawnJournal` + content-addressed `outRef`).** Without it there is no paired-bootstrap, no BH, no gate, no science. Every "mutable shared blackboard" proposal dies here. The archive (G-STEAL-3) is admitted *only* because it rides this same append-only spine.
- **Single-owner hierarchical legibility.** One owner per node, parent-chain readable top-down. An operator can answer "why did this spawn." Emergent controllers (opportunistic blackboard, clearing auction, variational posterior, churning MAP-Elites archive) all forfeit this. Keep the tree as the *control* topology even as the archive becomes the *memory* topology.
- **The `selector≠judge` firewall (`assertTraceDerivedFindings`, `src/loops/personify/analyst.ts:47`).** The write-only external judge is the keystone of valid measurement. Every graft is admitted *only* under this firewall — the refuter emits a defect not a score, the archive ranks on trace-findings not the judge, the widen-signal is corpus-distance not verdict. Never let a posted confidence or a bid or an archive-fitness become a back-channel for judge-leakage.
- **Typed `no-winner` (never silently "best").** Fail-loud on no valid result. The `progress` variant (G-STEAL-2) *enriches* this, it does not soften it into a fake success.
- **The blind-sample-and-select default.** Until the gate is green, the deployable runtime stays blind-sample + select. This is not timidity — it is the measured-best policy on every domain instrumented so far.

---

## 5. REVISED PHASE LIST

Folding the accepted grafts into the existing G1–G5 + combinators + Corpus plan. **The no-mechanism-ahead-of-the-gate discipline is honored: nothing that learns or grows the mechanism ships before the gate is green.**

**PHASE 0 — TURN THE KEY (unblocks everything; no new code).**
Run `bench/src/diverse-gate.mjs` (drop `--dry`): diverse-selector@k vs random@k at equal k under the deployable selector, paired-bootstrap + BH at significant n. Blocked only on a sandbox conflict (a finsearch GEPA run was flaking at ~14% stream-drop — do not fire a concurrent sandbox run; serialize). **This is the highest-priority action in the entire document.** Its result routes everything below:
- *Positive* → signal exists → escalate toward General-2: G-STEAL-4 (epistemic widen), then G-STEAL-6 (mechanism growth) become live.
- *Null/negative* → confirms blind-sample-and-select; the learned-allocation grafts (4, 6) stay deferred; runtime stays blind.

**PHASE 1 — ATTACK THE SIGNAL (higher priority than any expressiveness or learner work).**
Ship **G-STEAL-1 (incentivized refuter)** as a new `AgentProfile` + `{producer, refuter}` panel. Then run the second gate arm: *refuter-survival selection vs self-consistency at equal k* on the committed finsearch corpus. This directly attacks the −8.2pp deployable-selector loss and is runnable today. Verifiability is the bound (self-critique c); this is the cheapest shot at it.

**PHASE 2 — ENRICH THE TERMINAL CONTRACT (cheap, unblocks open-problem framing).**
Ship **G-STEAL-2** — `Outcome { solved | blocked | progress(frontier, confidence) }` + confidence stop. Additive typed change to `SupervisedResult`. Lets every downstream phase represent open problems honestly. Low risk, high enabling value.

**PHASE 3 — THE CORPUS AS A QD-ARCHIVE (the General-2 enabler).**
Build G2 directly as **G-STEAL-3** — `insert(record)` / `keepIfBetterInNiche(descriptor)` over the `ResultBlobStore` + `SpawnJournal` spine, *not* as a flat `appendRunRecord`. Generalize `defaultSelectWinner` to a per-niche comparator. This is the spine of cross-run learning; building it flat and migrating later is the avoidable mistake. The root `act` reads a diverse seed set.

**PHASE 4 — SCARCITY-AWARE ADMISSION (independent of the gate; pure improvement).**
Ship **G-STEAL-5 (shadow-price admission)** — one field on `SpawnOpts` + ~20 lines in `BudgetPool.reserve`, replacing the magic `THRESH`. Does not touch equal-k accounting, so it can land anytime; sequenced here because it pairs naturally with the widen-gate. Note: the operator override (2026-06-04, `recursive-execution-atom.md:276`) already greenlit building the LLM meta-driver *as the treatment* on top of the budget-reservation invariant with `WidenGate` flat for gate runs — shadow-price admission is the principled core of that meta-driver's widening rule.

**PHASE 5 — GATE-CONDITIONAL: LEARNED ALLOCATION.** *(ships only on a positive Phase 0/1)*
- **G-STEAL-4 (epistemic widen signal):** replace the undefined `promising()` with corpus-distance novelty. Needs Phase 3's archive. Firewall-clean (no verdict read).
- **G-STEAL-6 (proof-gated mechanism growth):** `proposeMechanism` / `admitMechanism` re-pointing the *existing* `heldOutGate` at the driver's operator set. Closes (d)+(e). This is the General-2 payoff and the last thing built — deferred until the gate proves a non-blind signal exists, because it is the canonical mechanism-ahead-of-the-gate trap.

**Deferred indefinitely (rejected substrates, not on the roadmap):** opportunistic blackboard control, clearing-auction / bucket-brigade allocation, variational free-energy core, free-running population, literal Gödel kernel rewrite, full recursive-debate executor. Each is rejected on a *measured* or *structural* basis above, not on taste — revisit only if a target domain acquires a total cheap verifier (the §1 tie-break).

**Priority summary:** Phase 0 (run the gate) ≫ Phase 1 (refuter signal) > Phase 2 (terminal contract) > Phase 3 (QD-Corpus) > Phase 4 (shadow-price) ≫ Phase 5 (learned allocation, gate-conditional). The reordering vs the prior plan: **signal work (refuter) is promoted above all mechanism work**, the **Corpus is built archive-shaped from day one**, and **all learner/mechanism-growth work is explicitly gated** on the one un-run command the whole repo is waiting on.

Written to `/home/drew/code/agent-runtime/docs/research/architecture-alternatives.md`.
