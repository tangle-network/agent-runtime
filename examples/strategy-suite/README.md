# Compare ways of spending an AI's attempts, fairly, on your own pass/fail check

Give an AI agent a task and a budget of, say, 3 attempts. Should it take 3 independent shots
and keep the best? Or take one shot, have a critic read what went wrong, and steer the next?
Those are two *strategies*, and which one wins depends on the task. This example runs both
(plus one you write yourself) against the same task, at the same budget, scored by the same
check, and prints who won.

You bring three things: a **task**, a **check** that says pass/fail (your own code, never an
LLM's opinion), and a **budget**. The library brings the strategies and a fair tournament.

## Why it matters

The gap between a mediocre agent and a good one is often not the model, it's how you spend
its attempts. Best-of-N, iterate-with-feedback, retry-on-flake all cost the same tokens and
win on different tasks. This gives you an apples-to-apples bench to find out which, instead
of guessing, and a 10-line way to add your own idea to the race.

## The three strategies in this run

- **`sample`** — take N independent attempts, keep the one that passes the check. (Best-of-N.)
- **`refine`** — take one attempt, a critic reads the failure trace and writes a hint, feed
  the hint into the next attempt, repeat until it passes.
- **`doubleCheck`** — the one this file writes from scratch (in ~15 lines), to show how. Its
  rule the built-ins don't have: never trust a single passing attempt, require the solution
  to pass **twice in a row** before stopping. That's a guard against a lucky pass on a flaky
  task (real tools, non-deterministic tests). On this deterministic toy task it just matches
  `refine` plus one confirming shot; its payoff shows up when passes are unreliable.

The task itself is deliberately trivial (drive a counter to 5 using an `increment` tool,
verify with `read_count`) so the file is about the *strategy machinery*, not the puzzle.

## Run it

```bash
pnpm tsx examples/strategy-suite/strategy-suite.ts
```

No API key needed. Without one, the "model" is a small deterministic in-process responder
(no network, no server) that drives the counter correctly on the first shot. Because it
never fails, **all three strategies tie at 100%** — that is expected: the offline run proves
the *wiring* (equal budget, scored by your own check), not that the strategies differ. The
run prints a banner saying exactly this, then a report table.

To make the strategies actually separate, point it at a live model so attempts can fail and
`refine`'s feedback loop can earn its keep:

```bash
TANGLE_API_KEY=sk-tan-... pnpm tsx examples/strategy-suite/strategy-suite.ts
```

`WORKER_MODEL` (default `gpt-4o-mini`) and `ROUTER_BASE` are optional overrides.

## Files

| file | what it is |
|---|---|
| `strategy-suite.ts` | authors `doubleCheck`, wires the offline responder, runs the comparison |
| `counter-env.ts` | the toy domain: the counter, its two tools, and the pass/fail check |

## Where to go next

- To have an AI *write* new strategies from the tasks each one loses on, and promote a winner
  only if it beats the incumbent on held-out tasks, see
  [`../strategy-evolution/`](../strategy-evolution/) (it reuses this same counter domain).
