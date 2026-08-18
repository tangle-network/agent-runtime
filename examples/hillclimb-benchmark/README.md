# Hillclimb a benchmark

The complete loop, one file: pick a benchmark, measure a baseline, let an optimizer search, re-measure on held-out tasks the search never saw, and keep a durable experiment record.

## When to use it

Use this example when you have a task family with a real pass/fail check and want an agent that measurably improves on it — not a one-off score.
It is the pattern behind every self-improvement run in this repository:

1. **Pick the benchmark.** Here: **SWE-bench-Live**, real GitHub issues refreshed monthly, so a model's training data cannot already contain the fix. The benchmark is five functions (an `Environment`); swap in your own domain by editing one file.
2. **Baseline.** Generation 0 races the fixed strategies `sample` and `refine` at equal budget. The winner is the incumbent.
3. **Optimize.** Each generation, an author model writes candidate strategies from the incumbent's recorded losses; a tournament advances a champion. This is `runStrategyEvolution` — the same search that `bench/src/swe-self-improve.mts` runs at full fidelity.
4. **Held-out re-measure.** The gen0 champion and the final champion are re-run fresh, paired, on a holdout slice the search never touched. Promotion needs the paired-bootstrap confidence interval to clear zero — a champion that got lucky does not promote.
5. **Read the record.** The full `EvolutionReport` is written to disk, and both finalists land in agent-eval's `ExperimentTracker` with the report attached as evidence, so the claim stays connected to its proof.

## How to run it

A router key, a dollar ceiling, and the exact token prices for your model are required.
Prices are dollars per million tokens; check your provider's catalog.

```sh
TANGLE_API_KEY=sk-tan-... \
MAX_USD=5 PRICE_IN_PER_M=0.27 PRICE_OUT_PER_M=1.10 \
pnpm tsx examples/hillclimb-benchmark/hillclimb.ts
```

Every model call — worker, analyst, author — flows through one metered transport.
It refuses the next call once the ceiling is reached, so a run can overshoot by at most one completion.
Cost is metered from response usage at your configured rates; billed prices can differ, so treat `MAX_USD` as an estimate-based hard stop, not an invoice.

Knobs: `WORKER_MODEL` and `AUTHOR_MODEL` (default `deepseek-v4-flash`), `TRAIN_N` (default 6), `HOLDOUT_N` (default 8), `GENERATIONS`, `POP`, `BUDGET` (rollouts per strategy per task), `ROUTER_BASE`.
Cost scales with `TRAIN_N × BUDGET × strategies` plus the holdout; start small and read the printed spend.

The run ends with:

```
gen0 champion:   ...
final champion:  ...
promoted:        true|false  (reason)
held-out lift:   mean ... [low, high], n=...
spend:           $... over N calls (ceiling $...)
experiment log:  .hillclimb-runs/<timestamp>/experiments.json (verdict: ...)
full report:     .hillclimb-runs/<timestamp>/evolution-report.json
```

`promoted: false` on a small run is the gate doing its job: a handful of tasks is rarely enough paired evidence.
Raise `TRAIN_N`/`HOLDOUT_N` (20–50 tasks) before treating a promotion as real.
The tracker verdict stays `ITERATE` until an experiment accumulates three reps — one run is one rep, never a conclusion.

## Why it is built this way

**The check grades produced state, not chat text.** After each rollout the environment reads `git diff` in the workspace. Three checks: the worker edited something, the change is focused (≤ 8 files), and it touches at least one file the reference fix touched. The reference patch never enters the worker's context.

**The check is a localization proxy, stated plainly.** "Edits the right files" is a real, cheap, deployable signal, and it is not the official `resolved` metric — that requires each instance's Docker test harness. When you need test-execution fidelity, run `bench/src/swe-self-improve.mts` (see [`bench/HARNESS.md`](../../bench/HARNESS.md)); this example keeps the identical search-and-gate shape at a cost you can smoke-test.

**Train and holdout cannot overlap.** The task supplier maps `(offset, n)` straight to dataset row offsets; train draws `[0, trainN)`, the holdout draws past it. A good holdout score cannot be memorization of the practice set.

**The record outlives the run.** Scores that live in a terminal scrollback are not evidence. The report JSON plus the `ExperimentTracker` entries (with `EvidenceRef` pointers back to the report) give the next session the exact champion, the gate verdict, and the proof path.

Related: [`strategy-evolution`](../strategy-evolution/) is this loop on a toy domain (no network, cheap); [`improve`](../improve/) optimizes one profile field instead of a strategy; [`docs/improve.md`](../../docs/improve.md) is the full improvement reference.
