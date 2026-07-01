# self-improving-coder

The self-improvement flywheel, composed cleanly, on a **contamination-proof** coding task. An agent authors candidate strategies from its training-set losses, then a **held-out gate** ships a change only if it beats the current agent on fresh tasks the search never touched — so registering an agent for self-improvement can never make it worse.

Nothing here is hand-rolled: the agent is an `AgentProfile` worker, the task is an `AgenticSurface`, and the gated flywheel is `runStrategyEvolution` + `promotionGate` (a seeded paired-bootstrap CI on a disjoint holdout, read exactly once).

## Run

```bash
# $0, no creds — proves the task is solvable AND the grader discriminates before spending anything.
CALIBRATE=1  pnpm tsx examples/self-improving-coder/self-improving-coder.ts

# the real flywheel (needs a router key + python3/pytest on the host to run the deployable check).
TANGLE_API_KEY=sk-...  pnpm tsx examples/self-improving-coder/self-improving-coder.ts
```

Env knobs: `WORKER_MODEL` (default `deepseek-v4-flash`), `AUTHOR_MODEL` (default `gemini-2.5-pro`), `TRAIN_N`, `ROUTER_BASE`.

## What you'll see — and why "No promotion" is the honest, correct result

**The bundled task is deliberately simple** — a few wire-protocol functions fully pinned by their tests. A capable model aces it (every strategy scores 1.0), so the gate **correctly returns no promotion**: you cannot demonstrate improvement where there is no headroom, and this harness refuses to fake one (`calibrate-before-measure`, enforced). That null is the point — the gate is honest.

**To see a real promotion, give it a task with a correctable middle band** (some attempts pass, some fail — the only regime where improvement is measurable):
- swap `environment`/`tasks` for the algorithmically-hard generated env in [`../ablation-suite/hard-coding-env.ts`](../ablation-suite/hard-coding-env.ts), or
- swap in the SWE-bench `Environment` (`bench/src/benchmarks/swe-bench.ts`) — everything else is identical. *(SWE-bench is contamination-**suspect**: its bugs are public GitHub fixes a model may have memorized — report that, never claim clean.)*

## Why contamination-proof

Each task is a small wire-protocol library whose constants (version, separators, checksum modulus, opcode) are **derived from the seed** and specified **only** by the test file — so a frontier model cannot have memorized the fix; the exact contract is generated per task. Graded by **real pytest** (a deployable check), never an LLM judge.

## Related

- [`improve`](../improve) — the one-call `improve(profile, findings)` facade over this loop.
- [`self-improving-loop`](../self-improving-loop) — the same gate on a prompt surface, offline.
- [`strategy-evolution`](../strategy-evolution) — the multi-generation `runStrategyEvolution` in isolation.
