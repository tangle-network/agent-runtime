# strategy-suite

The optimization suite (`@tangle-network/agent-runtime/loops`) in three
layers, on a tiny in-memory `Environment` — no benchmark dataset, no gym, no
sandbox.

The model: you have a **task**, a deployable **check**, and a compute
**budget**. A *strategy* is **how you spend the budget to beat the check**.
You implement an `Environment` (5 hooks: `open` / `tools` / `call` / `score`
/ `close`) and get the strategies compared, scored by your own check, for
free.

1. **Just run it** — `runBenchmark({ environment, tasks, worker })` compares
   strategies at equal budget and reports the paired lift.
2. **Pick built-ins** — `sample` (N independent attempts, keep the
   best-verifying), `refine` (attempt → critic reads the trace → steer the
   next → repeat), `adaptiveRefine` (refine, but abandon-and-restart a line
   that stops improving), `sampleThenRefine`.
3. **Author your own** — `defineStrategy(name, body)`. A body composes two
   steps — `shot()` (one worker attempt over the artifact) and `critique()`
   (the firewalled analyst reads the trace → a steer) — with zero
   Supervisor/Scope ceremony. The example authors `doubleCheck` inline.

## Run

```bash
TANGLE_API_KEY=... pnpm tsx examples/strategy-suite/strategy-suite.ts
```

The worker calls the Tangle router, so a key is required (`WORKER_MODEL` /
`ROUTER_BASE` optional). Everything else — the environment, the check, the
strategies — runs in-process.

## Where to go next

- **Evolve strategies instead of hand-picking them** —
  `runStrategyEvolution` + `authorStrategy` + `promotionGate` (same subpath)
  author candidate strategies from observed per-task losses and promote only
  what wins on a held-out slice.
- **Real domains + the empirical results** — `bench/HARNESS.md` (the
  canonical suite over EnterpriseOps-Gym, coding, and answer-shaped domains)
  and `bench/src/examples/` (the counter demo's bigger siblings).
- **Custom recursive topologies** below the strategy layer —
  [`examples/recursive-supervisor/`](../recursive-supervisor/).
