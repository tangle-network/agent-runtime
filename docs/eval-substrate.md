# The eval substrate — north star, methodology, and building discipline

## The bigger goal (read this first, repeat it often)

**We are building the neutral measurement substrate for AI agents: the system that can answer, with execution-grounded evidence, "which (harness × model × provider × strategy) combination is actually best for task-class X" — cheaply, for any axis, on demand.**

Everything else — a you.com comparison, a coding benchmark, a research leaderboard — is **one cell** of that matrix. The product is the *measurer*, not any single measurement.

Why this goal:

- **Every buyer of AI infrastructure has this question and nobody neutral answers it.** Vendors publish self-serving benchmarks; academic benchmarks go stale and don't cover the buyer's axis (their harness, their provider choice, their task-class). The neutral, current, per-axis measurer is the missing layer.
- **Honesty is the moat.** A measurer that reports "you tie here, you win there" is trustable; a marketing benchmark is not. A parity result is an *asset* for the substrate even when it disappoints a vendor — it's the proof we measure fairly. We never trade this away.
- **It compounds with this repo's thesis.** The substrate is the judge/corpus half of the learning flywheel (`docs/learning-flywheel.md`): the same execution-grounded verdicts that rank providers are the training signal for self-improving agents. One investment, two products.

## Where this sits in the vision (the hierarchy, explicitly)

**The product is the RSI agent runtime** (`architecture.md` is the spine): a literal agent that **acts**, **dispatches** agents, carries a **policy**, **parallelizes** through the combinators, and is **analyzed** and improved from its traces. That program is the point. This document describes the layer that program needs and sells:

- **The eval substrate is the grounding + the sellable exhaust.** Self-improvement needs external, execution-grounded verdicts (a model grading itself is self-delusion — the same circularity as a model validating its own generated tests). The *same* leaderboard that grounds the loops is the commercial artifact: it runs **plain harnesses today → agent profiles next → the RSI loops eventually**, on the same benchmarks — the public, longitudinal proof the runtime delivers lift.
- **`generate-eval` is one skill** — a software-3.0 leverage point we pick up along the way. It closes eval-scenario gaps by minting deployable checkers with correctable bands (the inputs the RSI gate has been starving for). It is an *instance running on the runtime* (a `loopUntil` with a deterministic certifier as its validator), not a pillar beside it.

Why the alternatives are worse:

- *"Hand-author benchmarks per engagement"* — doesn't scale, goes stale the day a library ships a new release, and the authoring bottleneck caps how many axes we can sell.
- *"Use existing public benchmarks"* — stale by construction (models train on them), rarely cover the buyer's axis, and saturate (SimpleQA-style ceilings) or floor (research hard-mode), so they stop discriminating exactly where decisions get made.
- *"Optimize one vendor-pleasing number"* — destroys the only durable asset (neutrality), and dies the first time the honest answer is "parity."

## Architecture: two durable pieces

### 1. `generate-eval` — the data engine

An agent authors eval tasks; **the runtime certifies them**. A generated task is admitted only if it survives two machine gates:

1. **Grounding gate** — the reference solution actually executes and passes against the real, pinned, current target (a real library in a sandbox; a citable primary source for QA). *The library/source is the oracle — never the generating model's belief.* This kills the circularity trap where a model "validates" a test against its own stale memory.
2. **Discrimination gate** — a no-search/parametric baseline must *fail* the task. A task every model already solves measures nothing; admit only tasks with a correctable band.

Inputs that auto-target freshness: recent release notes / changelogs (new API surface is search-dependent by construction); existing repos with existing test suites (highest validity — reuse, don't reinvent tests).

The loop: author → execute → (fix until the reference builds and passes) → run parametric baseline → admit/reject. Iteration is expected; "didn't compile after 1 rollout" is a normal intermediate state, not a failure.

### 2. The unified leaderboard — the presentation

One corpus of cells: `(task-class, harness, model, provider/arm) → {pass, lift-vs-baseline, paired discordants + exact sign-test p, tokens, latency, cost, citations, cited-authority, tools-actually-fired}`. One exporter renders the cross-axis report (REPORT.md + results.csv + tasks.json + summary.json, zip/gist-shareable). Every aggregate must be reproducible from the raw cells in the same bundle.

The arms must be **provably isolated**: when an arm claims "provider P only," the tool-call log must show P's tools fired and the native tools did not. "Tools used" is a column, not an assumption.

## Measurement methodology (non-negotiables)

1. **Deterministic or execution-grounded oracles.** Exact-identifier checks, test suites, verifiable sources. An LLM judge is a last resort and is labeled as such.
2. **One variable per comparison.** Within a comparison, only the arm changes (same harness, same model, same tasks). Cross-harness numbers are never presented as same-model comparisons.
3. **Paired statistics on the same tasks.** Report discordant pairs and the exact sign test, not just pooled deltas. Small-n directional results are labeled directional.
4. **Discrimination before scale.** Before any expensive run: a cheap pilot proving the axis can move (a parametric-fail baseline, a saturation check). Never spend on a saturated or floored axis.
5. **Infra errors are excluded and reported, never counted as failures.** No silent zeros.
6. **The execution record is part of the result.** Tool calls, tokens, latency, citations ship with every cell so "did it really search, with what, at what cost" is auditable.
7. **Honest verdicts, including parity and losses.** The report states what was measured vs inferred, and its threats to validity, in the artifact itself.

## Building discipline (this repo and others)

The norm: **for every substantive step, say (a) what we're doing, (b) why it matters to the north star, (c) why the obvious alternatives are worse, (d) how the claim was verified.** Repetition is a feature — re-state the goal whenever work resumes or direction changes.

1. **Goal before execution.** Before optimizing anything, validate it's the right axis: who consumes this result, what decision does it change, does the axis discriminate? Re-ask mid-build; sunk effort is not a reason to continue.
2. **Ground truth over inference.** Claims about behavior come from running the thing (or reading its source), never from types, docs, or memory. If a probe contradicts the model's belief, the probe wins.
3. **Check existing before building.** Grep for the primitive first; extend it rather than fork it. A new module must name why the existing one couldn't absorb the change.
4. **Cheapest decisive check first.** Order work so the experiment that could invalidate the plan runs earliest (a 2-cell smoke before a 63-cell matrix; a parametric pilot before a benchmark).
5. **Verify before claiming, at every layer.** Typecheck/lint/tests before "built"; a live probe before "works"; the artifact opened before "shipped." Failed verification is reported as-is.
6. **Secrets never print.** Probe with `${VAR:+SET}`-style existence checks only. A leaked credential is rotated immediately and flagged loudly.
7. **Estimate cost before launch.** cells × per-cell-time / concurrency, stated before any fleet/benchmark run.
8. **Honest reporting is non-negotiable.** Parity is publishable. Overclaim once and the substrate is worthless.
9. **Durable knowledge gets written down the same turn** — maps, memory notes, this document — so the next session starts from the map, not re-discovery.
