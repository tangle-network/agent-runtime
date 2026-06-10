# Examples — the optimization suite in three layers

`strategy-demo.mts` is the smallest end-to-end demonstration of the optimization suite.
It runs on a toy "counter" `Environment` so it needs only a router key — no benchmark
dataset, no sandbox, no gym.

```bash
TANGLE_API_KEY=... WORKER_MODEL=gpt-4o-mini pnpm tsx src/examples/strategy-demo.mts
```

## The model

You have a **task**, a deployable **check**, and a compute **budget**. A *strategy* is
**how you spend the budget to beat the check**. You implement an `Environment` (5 hooks)
and get the strategies compared, scored by your own check, for free.

## The three layers (each is a few lines in the demo)

1. **Just run it** — `runBenchmark({ environment, tasks, worker })` compares the default
   strategies and reports the paired lift. Black box; no vocabulary needed.

2. **Pick strategies** — pass `strategies: [sample, refine, adaptiveRefine]`. Named by
   what they *do*:
   - **`sample`** — N independent attempts, keep the best-verifying (best-of-N / resample).
   - **`refine`** — attempt → a critic reads the trace → steer the next → repeat (iterate).
   - **`adaptiveRefine`** — refine, but abandon-and-restart a line that stops improving
     (branch-when-stuck).

3. **Author your own** — `defineStrategy(name, body)`. A strategy body composes two steps
   — `shot()` (one worker attempt over an artifact) and `critique()` (the firewalled
   analyst reads the trace → a steer) — with **zero** Supervisor/Scope ceremony. The demo
   authors `doubleCheck` inline in ~10 lines. This is the unit a skill (or an agent) emits.

## The answer-shaped template — `math-demo.mts`

`math-demo.mts` is the same suite on the **answer-shaped** domain template — the shape
tax/legal/gtm products use. `createVerifierEnvironment({ name, check, extraTools,
callExtra })` builds the whole `Environment` from one deterministic `check` (here: 3
GSM8K-style problems, graded by exact numeric match), and `sampleThenRefine` joins the
built-ins compared at equal budget.

```bash
TANGLE_API_KEY=... WORKER_MODEL=gpt-4o-mini pnpm tsx src/examples/math-demo.mts
```

## The hooks you customize (world-class-DX surface)

- **the check / verifier** → `Environment.score` (your deployable success criterion)
- **the critic / steerer** → `worker.analystInstruction` (the analyst prompt; GEPA tunes this)
- **the worker** → the model (`worker.model`)
- **the strategy** → `defineStrategy` (or drop to `runAgentic` / the Supervisor for novel topologies)

## Where the real results live

On a trivial task all strategies tie. The differences (e.g. refine/adaptiveRefine beating
sample on stateful agentic work, +16.4pp on EnterpriseOps-Gym) show on real domains — see
`bench/HARNESS.md` and `bench/src/agentic-run.mts` (the EOPS Environment), and
`bench/src/eops-gepa.mts` (GEPA evolving the analyst/critic prompt against the check).
