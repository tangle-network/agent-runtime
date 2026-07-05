# Does a team of AI agents beat one AI agent — and when?

Everyone assumes "just add more agents" makes an AI system smarter. This suite actually measures it.
It runs the **same coding task** three ways — one agent, a team, and a middle option — scores each,
prices each, and tells you with real statistics whether the team was worth the extra cost.

The output is a full autopsy of every run: did it solve the task, how well, how many tokens and
dollars it burned, and a confidence interval on the difference between the team and the lone agent —
so you never mistake noise for a real win.

## The three ways to run the task

- **continuous** — **one** agent that keeps its whole conversation across every attempt. It
  remembers everything it tried, but its context keeps growing until it's bloated and expensive.
- **ralph** — **one** agent, but a **fresh** copy each round that only sees a single scratchpad file.
  Never bloats, but forgets what earlier attempts learned.
- **supervisor** — a **coordinator** agent that spawns a fresh worker each round *and* keeps a memory
  of what failed (a helper feeds it the actual failing tests). It gets both fresh worker context and
  accumulated memory — the best of the other two.

## Why the task can't be cheated

The agents solve coding problems whose answers can't be memorized from training data: a synthetic
"oscillation" task generated fresh each run, or (with `EVAL=verkit`) reconstructing a real library
from scratch. The agent only sees a few example tests while it works; it's graded on a **hidden**
test set it never saw, so a solution that pattern-matched the visible cases still fails. The score is
the fraction of hidden tests that pass — execution truth, not the model's own claim.

## Run it

```bash
TANGLE_API_KEY=…  pnpm tsx examples/ablation-suite/run-ablation.ts
```

Needs a model API key (it calls a real model for every attempt, through the Tangle router by
default). Env knobs:

| var | default | what it does |
|---|---|---|
| `ARMS=cal` | (all 3 arms) | **calibration run: continuous agent only** — always run this first (see below) |
| `EVAL=verkit` | synthetic | swap the synthetic task for real-library reconstruction |
| `WORKER_MODEL` / `DRIVER_MODEL` | `deepseek-v4-flash` | the worker model and the supervisor model |
| `BUDGET` | 12 | max attempts per agent |
| `HOLDOUT_N` | 8 | how many hidden tasks to grade on |
| `ROUTER_BASE_URL` | `https://router.tangle.tools/v1` | the OpenAI-compatible endpoint the key hits |

Output is the full autopsy per arm: solve rate, mean score, tokens in/out, model calls, retry count,
dollars, latency, per-tool counts, and a **paired-bootstrap delta** — the mean improvement over the
lone agent, with a 95% confidence interval — so you can see whether the team actually earned its cost.

### Always run `ARMS=cal` first

If a single agent already aces the task, there's no room left for a team to win — you'd spend 3x the
money to prove nothing. The calibration run checks that the lone agent still *fails* often enough to
leave a middle band worth competing in. If it aces the eval, make the task harder before paying for
the full three-way. (This was learned the expensive way.)

## What it found

- **The team wins: +20.8 points** (out of 100) over a single agent — 95% CI [8, 38], n=24, on the
  weak `deepseek-flash` model. It solved every task the lone agent did, plus more, and lost none. The
  **ralph** arm *lost* (−8.3 points), which pins the win on the supervisor's accumulated memory, not
  on spawning fresh agents.
- **It's a weak-model amplifier, not free lunch.** On a frontier model (`gemini-2.5-pro`) the lone
  agent already solves everything (100%, all three arms), so the team adds nothing at 3x the cost.
  Coordination pays off exactly when a single worker is in the shaky middle — a stronger worker
  shrinks that band.

## Files

| file | what it is |
|---|---|
| `run-ablation.ts` | the entrypoint: reads env knobs, runs the three arms, prints the autopsy |
| `ablation.ts` | the knob-board + the autopsy report (scores, cost, tokens, the paired-bootstrap delta) |
| `long-coding-env.ts` / `long-coding-env-lite.ts` | the synthetic, uncheatable oscillation task |
| `verkit-env.ts` | the real-library reconstruction task (`EVAL=verkit`) |
| `ralph-strategy.ts` | the fresh-agent-each-round "ralph" arm |
| `persistent-surface.ts` / `counting-surface.ts` | the graded workspace + per-tool call counting |
