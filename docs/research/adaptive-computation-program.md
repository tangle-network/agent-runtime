> **Track:** Theory + experiments (research) · **Role:** the adopted external framings + the E6–E9 experiment slate they contribute · **Status:** criteria adopted; E6/E7 queued (ticketed), E8 designed, E9 = the running powered-run family

# Adaptive computation — adopted criteria and the extended experiment slate

Two external research essays (2026-06-10, adjudicated against this repo's measured
evidence) independently converged on the program this repo already runs: the optimization
object is the **adaptive computation strategy** — how an agent allocates budget, branches
vs deepens, times critique/verification, selects, stops, and reads/writes memory — not
the prompt. That object is shipped here as `Strategy`/`defineStrategy`
(`src/runtime/strategy.ts`); the matched-budget search over it is `runStrategyEvolution`;
the validated-modification loop is `authorStrategy` + `promotionGate`. The essays'
"mechanism-first, kill-condition-per-claim" filter matches `docs/ANTI_PATTERNS.md` and
the admission discipline in [leapfrog-program.md](./leapfrog-program.md).

What the essays CONTRIBUTE beyond what is built — two criteria and two experiments —
is recorded here so the slate has one home. E1–E5 live in
[leapfrog-program.md](./leapfrog-program.md); the live portfolio ranking lives in
[optimization-space.md](./optimization-space.md).

## Adopted criterion 1 — ε-action-sufficient state

A state/memory mechanism is admissible only if **decisions made from the compressed
state are nearly as good as decisions made from the full history**:

    |Q(h_t, a) − Q(z_t, a)| ≤ ε   for every action a

Kill condition: *a mechanism that improves recall but not decision quality is retrieval,
not state.* This criterion has already fired in our data — naive prose-fact corpus
priming improved recall-shaped metrics while DEGRADING outcomes (−11.6pp, worsening
slope). Every future memory/corpus arm (E3's certified-strategy library, the
relevance-primed A/B, any graph-memory integration) is scored on **decision regret and
calibration**, never on recall. Cross-link: the sharper in-repo treatment of why belief
machinery must wait for a deployable calibratable signal is
[belief-state-learner-spec.md](./belief-state-learner-spec.md).

## Adopted criterion 2 — compute parity is verified, not assumed

With uncapped worker turns (stuck-loop detection + a pathology backstop instead of turn
ceilings), "equal budget" can no longer be assumed from matched shot counts. The
conserved pool records real `{usd, tokens}` per cell; comparisons report **measured
spend parity between arms**. A lift claim whose arms diverge materially in measured
spend is a dose confound, not a finding (the S2 discipline, restated for the
unlimited-turns world).

## E6 — deceptive-improvement benchmark (optimizer robustness)

The promotion gate already *defends* against train-good/holdout-bad strategies (they
don't promote). Unmeasured: how much search budget the optimizer **wastes** inside
deceptive local optima, and whether search escapes them.

Design: a small task set engineered so that named local edits improve train but hurt
holdout — "always verify", "always ask clarification", "always widen", "always trust
memory". Run the standard evolution loop; measure (a) fraction of authored candidates
that are deceptive-optimum instances, (b) rollouts wasted on them before escape,
(c) whether the final champion is one (the gate should make this 0 — verifying THAT is
the point). Compare single-lineage vs population search on escape rate.

Status: DESIGNED. Falsifier: if deceptive optima are rare in practice (authors don't
propose them), the benchmark retires as unnecessary.

## E7 — fault-injection credit assignment

Inject controlled faults into one component of an agent graph at a time (retrieval,
planner, state update, verifier wiring, selection, stopping); the diagnostic layer sees
only traces and scores. Measure correct-component attribution rate, patch acceptance
rate, and regression rate vs end-to-end reflection. This validates the substrate's
diagnose machinery (agent-eval ≥0.89: causal sweep, responsibility scoring, trace
contracts) on ground-truth faults — attribution claims get a denominator.

Status: QUEUED (ops-board ticket; runs after the current powered-run family).

## E8 — predictive-belief steerer arm

The cheap instantiation of "action-conditional state beats prose state": an analyst
variant that emits calibrated per-check predictions (e.g. `P(check_i passes | one more
shot on this artifact)`) and steers on expected value-of-continuation, screened against
the default unfinished-items analyst in the existing steerer harness on EOPS. Scored by
criterion 1: decision regret, not prediction quality alone — a state that predicts
better but does not choose better fails.

Status: DESIGNED (the steerer-population fitness harness exists).

## E1-coarse — the leakage-bounded author channel

arXiv:2606.11045 (Bertran/Roth/Wu) measured that ML-agent exploration survives a one-bit
feedback channel with no performance loss — the operational form of the Blum–Hardt
ladder. Our translation: `lossesDetail: 'binary'` caps what the author learns from a
tournament at pass/fail per task (one bit per cell per generation). The A/B this enables:
authoring quality under binary vs exact losses — if quality holds, multi-generation runs
get ADA-robustness essentially free. The open transfer question their result does not
settle: our author composes from failure STRUCTURE, not accept/reject, so the bits it
needs may genuinely exceed one per cell. Status: BUILT (config flag), unrun.

## E2b — reproducer certification

Same paper, their headline instrument: compress the winning strategy into a ~64-word
summary; a fresh author re-implements from the summary alone (no losses, no code); score
the reproduction on the same holdout. A reproduction gap means the champion's win did
not fit through the summary — an overfitting signal (their detector: 100% sensitivity /
91% specificity in the ML-agent setting). Semantic compressibility, where gzip-bits (E2)
is syntactic. Status: BUILT (`reproducerCheck` on `runStrategyEvolution`, report-level
auxiliary, never gate-blocking in v1), unrun. Their Cor. 2 also gives the sizing formula
relating summary token budget B to holdout n — use it to choose m once our artifacts'
measured budgets stabilize.

## E9 — matched-budget strategy search at power (the running family)

The essays' flagship experiment is this repo's powered evolution run: baselines vs
authored adaptive-computation strategies, matched budget through the conserved pool,
explicit selection rules, fresh-slice promotion gate, band-aware holdout
(`band.holdoutPoolN` — the estimand "paired lift on headroom tasks", pre-registered).
Each run also feeds E2 for free (gzip-bits per authored artifact vs holdout gap).

Status: RUNNING (n=24/budget-4 family; band + tool-selection arms land in the next run).

## Rejected without prejudice (named triggers, not dead)

- **Flow-based / GFlowNet design samplers** — premature until a run demonstrates the
  design landscape is multimodal (distinct candidates winning distinct task slices —
  observable in any E9 report). The archive + divergence-instructed population is the
  cheap probe.
- **Posterior over agent designs Q(θ) with variational updates** — the cheap step is
  archive weights for routing, already representable; full machinery gates on evidence
  that specialized variants dominate one tuned strategy on task slices.
- **Risk terms in the objective without their own deployable checkers** — decoration by
  the program's own filter; each objective component ships a checker or stays out.
