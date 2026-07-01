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
2. **Pick built-ins** — this run compares two: `sample` (N independent attempts, keep the
   best-verifying) and `refine` (attempt → critic reads the trace → steer the next → repeat). Two more
   ship and swap in the same way: `adaptiveRefine` (refine, but abandon-and-restart a line that stops
   improving) and `sampleThenRefine`.
3. **Author your own** — `defineStrategy(name, body)`. A body composes two steps — `shot()` (one worker
   attempt over the artifact) and `critique()` (the firewalled analyst reads the trace → a steer) — with
   zero Supervisor/Scope ceremony. The example authors **`doubleCheck`**: a policy the built-ins *don't*
   have — it never trusts a single passing shot, requiring the solution to pass **twice in a row** before
   it stops (a flake/luck guard). `refine` ships on the first pass; `doubleCheck` re-verifies once more.
   The payoff is real on a non-deterministic surface (flaky tools/tests) — the whole point of authoring a
   stop-condition the library doesn't ship, in ~10 lines.

## Run

```bash
pnpm tsx examples/strategy-suite/strategy-suite.ts                      # offline (injected transport)
TANGLE_API_KEY=... pnpm tsx examples/strategy-suite/strategy-suite.ts   # live Tangle router worker
```

With no key the worker runs against an injected `complete` transport
(`RouterConfig.complete`) — a deterministic in-process responder that drives
the counter — so the whole comparison runs end-to-end with zero credentials
and no localhost server. Set `TANGLE_API_KEY` to swap in the live Tangle
router as the drop-in upgrade (`WORKER_MODEL` / `ROUTER_BASE` optional).
Everything else — the environment, the check, the strategies — runs
in-process either way.

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
