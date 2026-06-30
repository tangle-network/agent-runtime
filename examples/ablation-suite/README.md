# ablation-suite

Does a **supervisor (a team of coordinated agents)** beat a **single agent** at the same job — and when? This suite measures it, cost-aware, on contamination-proof coding tasks.

## The three arms (the lever under test)

- **continuous** (`refine`) — one worker, carries its conversation across attempts. Remembers, but its context bloats.
- **ralph** (`ralph-strategy.ts`) — one persistent file, a **fresh** agent each round. Never bloats, but forgets.
- **supervisor** (`driverSteer`) — a driver brain spawning serial workers + the `failuresAnalyst` (which hands the driver the actual failing tests). Gets both: fresh worker contexts **and** accumulated memory.

## Run it

```bash
TANGLE_API_KEY=…  tsx examples/ablation-suite/run-ablation.ts
```

Knobs (env): `ARMS=cal` (regime check — continuous only), `EVAL=verkit` (the real-library task), `HOLDOUT_N`, `BUDGET`, `WORKER_MODEL`, `DRIVER_MODEL`. Output is the full autopsy: resolve, pass-fraction score, tokens in/out, LLM calls, refine-shots, $, latency, per-tool counts, and a paired-bootstrap Δ vs the single agent.

**Always run `ARMS=cal` first.** If the single continuous agent already aces the eval, there's no middle band for the supervisor to win in — bump difficulty before spending on the full three-way. (We learned this the expensive way; see the discipline below.)

## What it found

- **Supervisor +20.8pp over a single agent** (95% CI [8, 38], n=24, deepseek-flash) — Pareto-dominant: it solved every task the single agent did, plus more, and lost none. **Ralph loses** (−8.3pp), so the win is the driver's accumulated memory, not fresh respawn.
- **It's a weak-model amplifier.** At frontier (gemini-2.5-pro) the same eval is solved solo (100% all arms), so the supervisor adds nothing at 3× cost. Coordination's value lives in the *worker's* middle band — a stronger worker shrinks it.

## Files

`ablation.ts` (the knob-board + autopsy) · `long-coding-env.ts` / `long-coding-env-lite.ts` (synthetic oscillation evals) · `verkit-env.ts` (real-library reconstruction) · `ralph-strategy.ts` · `self-improving-supervisor.ts` + `surface-worker.ts` (the supervisor seam + `failuresAnalyst`) · `persistent-surface.ts` · `counting-surface.ts` (per-tool counts).
