# Let an AI invent better ways to solve a task, and gate out the ones that only got lucky

Instead of you hand-picking how an agent spends its attempts, this loop has an AI *write* new
approaches, race them in a tournament, and keep the champion — but it only declares the
champion an actual improvement if it beats the starting point on a fresh set of tasks the
search never saw, by a margin too large to be noise. It's automated strategy search with an
anti-overfitting gate bolted to the end.

## Why it matters

Any search that optimizes against tasks it can see will eventually cheat: it finds tricks
that work on *those* tasks and fall apart on new ones. The fix is a **held-out** exam —
tasks locked away from the search — plus a statistical test so a champion that squeaked ahead
by chance doesn't get promoted. This example shows both: an AI proposing strategies, and a
gate strict enough to say "no, not proven" and mean it.

## What runs, each generation

1. **Author.** An AI model writes a small population of candidate strategies, informed by the
   tasks the current champion is losing.
2. **Tournament.** Each candidate plays the incumbent on the practice tasks at *equal budget*
   (same number of attempts), scored by the task's own pass/fail check. A champion advances.
3. **Promotion gate (once, at the end).** The final champion and the gen-0 champion are both
   run on a **held-out** slice of tasks the search never touched. A paired bootstrap
   confidence interval (resample the before/after task pairs many times) measures the lift.
   The champion is promoted only if that interval clears 0.

You supply three things:

- an **Environment** — five small functions (`open` / `tools` / `call` / `score` / `close`)
  that let the engine start your task, expose its tools, run them, and score the result with
  *your own* check. This example reuses the toy counter domain from
  [`../strategy-suite/counter-env.ts`](../strategy-suite/counter-env.ts).
- a **task supplier** `tasks(offset, n)` that hands back *non-overlapping* slices — practice
  tasks are drawn from `[0, trainN)`, the held-out exam from indices past that — so a good
  exam score can't be memorization of the practice set.
- an **author model** — the LLM that writes the candidate strategies.

The engine owns the tournament, the champion selection, and the gate.

## Run it

```bash
TANGLE_API_KEY=sk-tan-... pnpm tsx examples/strategy-evolution/strategy-evolution.ts
```

A key is required: both the worker (which drives the task) and the author (which writes
strategies) call the Tangle router. Optional overrides: `WORKER_MODEL` (default
`gpt-4o-mini`), `AUTHOR_MODEL` (default `deepseek-v4-flash`), `ROUTER_BASE`.

It prints the gen-0 champion, the final champion, the promotion verdict, the number of paired
tasks `n`, and the held-out lift with its confidence interval, e.g.:

```
gen0 champion:  sample
final champion: refine
promoted:       false  (held-out CI includes 0 — lift not beyond noise)
paired tasks:   n=8
held-out lift:  mean 0.125 [-0.100, 0.375]
```

**`promoted: false` is the expected outcome here, and it's the point.** The example uses a
handful of tiny tasks; that is far too little evidence to promote anything defensibly, so the
gate correctly refuses. Bring 20-50 tasks for a real promotion. A gate that ships on thin
evidence is worse than no gate.

## Going further

`StrategyEvolutionConfig` in `@tangle-network/agent-runtime/kernel` exposes more knobs this
example leaves at defaults, including `objective: 'cost'` (promote a candidate that ties the
score but is *cheaper*), a reference screen that drops already-solved tasks before the
finalists run, an overfitting check that re-implements the champion from a summary and
re-scores it, and checkpoints so a restart re-pays at most one phase.
