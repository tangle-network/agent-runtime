# An agent that improves itself — and can only ship a change if it's provably better

An agent solves coding tasks, learns from the ones it fails, and writes new **strategies** (better
plans for attacking the task) to try. The catch: a new strategy is only kept if it beats the current
agent on a batch of **fresh tasks the search never saw** — measured with a statistical test, read
exactly once. So the loop can make the agent better, but it can never make it worse, and it can never
fool itself into thinking it improved when it didn't.

Everything here is composed from the runtime's own pieces, nothing hand-rolled: the agent is a
worker profile, the task is a pluggable environment (open a workspace, offer tools, grade the
result), and the whole gated loop is one call — `runStrategyEvolution`.

## Why it matters

"Self-improving agent" is usually a demo that trains and tests on the same tasks, so it reports a
lift that's really just memorization. This example is built to make that impossible:

- **The gate is honest.** After the search, one decision is made on a **held-out** batch of tasks
  the search never touched, using a paired bootstrap confidence interval (a resampling test that
  asks "is this lift real or just luck?"). The held-out batch is disjoint by construction and read
  once, so the loop cannot quietly tune itself to the test.
- **The task can't be memorized.** Each task is a tiny wire-protocol library whose exact rules
  (version string, separator, checksum modulus) are **derived from a random seed** and defined
  *only* by the test file. A frontier model can't recall the answer — the contract is generated
  fresh per task. And it's graded by **real pytest**, not by another model's opinion.

## Run

```bash
# Step 1 — $0, no key. Proves the task is solvable AND the grader tells right from wrong,
# BEFORE you spend anything on models. If this fails, the task/grader is broken — fix it first.
CALIBRATE=1  pnpm tsx examples/self-improving-coder/self-improving-coder.ts

# Step 2 — the real loop. Needs a router API key, plus python3 + pytest on your machine
# (pytest is the grader).
TANGLE_API_KEY=sk-...  pnpm tsx examples/self-improving-coder/self-improving-coder.ts
```

Step 1 prints a clean calibration table — reference solution passes all 9 tests, empty stub passes 0,
on five different seeds:

```
═══ CALIBRATION ($0) — task solvable + grader discriminates? ═══
  seed 0: stub 0/9  →  reference 9/9  ✓
  seed 1: stub 0/9  →  reference 9/9  ✓
  seed 2: stub 0/9  →  reference 9/9  ✓
  seed 7: stub 0/9  →  reference 9/9  ✓
  seed 11: stub 0/9  →  reference 9/9  ✓

>>> CALIBRATED — task is solvable + the grader discriminates. Safe to run the loop.
```

Useful env knobs: `WORKER_MODEL` (the agent that codes, default `deepseek-v4-flash`), `AUTHOR_MODEL`
(the model that writes new strategies, default `gemini-2.5-pro`), `TRAIN_N`, `HOLDOUT_N`,
`ROUTER_BASE`.

## Why "No promotion" is the correct result on the bundled task

The bundled task is **deliberately easy** — a few functions fully pinned by their tests. A capable
model aces every attempt (each strategy scores 1.0), which leaves the gate no headroom to detect an
improvement, so it correctly reports **no promotion**. That null isn't a bug; it's the gate refusing
to invent a win where none exists. You can't demonstrate self-improvement on a task with no room to
improve, and this harness won't pretend otherwise.

To see a real promotion, give the loop a task with a middle band — some attempts pass, some fail:

- Swap in the algorithmically-hard generated environment at
  [`../ablation-suite/hard-coding-env.ts`](../ablation-suite/hard-coding-env.ts), or
- Swap in SWE-bench (`bench/src/benchmarks/swe-bench.ts`) — everything else stays the same. *(Note:
  SWE-bench bugs are public GitHub fixes a model may have memorized, so it's contamination-suspect —
  report that, don't claim it's clean.)*

## Files

| file | what it is |
|---|---|
| `self-improving-coder.ts` | the whole thing: the seed-derived task generator, the pytest-graded environment, the calibration self-check, and the gated `runStrategyEvolution` call |

## Related examples

- [`../improve`](../improve) — the one-call `improve(profile, findings)` shortcut over this same loop.
- [`../self-improving-loop`](../self-improving-loop) — the same held-out gate on a text/prompt task, fully offline.
- [`../strategy-evolution`](../strategy-evolution) — the multi-generation search in isolation, without the coding task.
