# agent-runtime-bench

External-benchmark harness for the agent-runtime loop. Answers the only question that matters: **does the steering loop actually beat blind multi-shot on real tasks, judged by a real, deterministic judge?** — not a self-authored unit test.

Private workspace nested in agent-runtime; decoupled from its build/lint/release (the package builds `src/`, lints `src tests examples` — `bench/` is none of those).

## Why this exists

Every "proof" of the steering loop so far is a deterministic unit test where we wrote both the worker and the driver. That proves the wiring, not the value. This harness runs the loop against benchmarks whose **judges are external and deterministic** (test pass/fail, programmatic state checks) — no LLM judge, no invented score noise.

## Design

`BenchmarkAdapter` (`src/benchmarks/types.ts`) is the seam every benchmark implements:
- `loadTasks()` → `BenchTask[]`
- `judge(task, artifact)` → `BenchScore` (the benchmark's own harness; deterministic)
- `goldArtifact(task)` → the oracle solution (to self-verify the judge before spending tokens)

The plan: A/B the loop's **drivers as variants** — `blind` (single attempt, no steering) vs an agentic driver (`createSandboxPlanner`, in a different or the same sandbox as the worker) — over a held-out task subset, against the benchmark's own judge. The worker calls a model through the **Tangle router** (all models behind it).

## Status

| Benchmark | Judge | Status |
|---|---|---|
| **SWE-bench Verified** | apply patch → run repo test suite (Docker, deterministic) | adapter real; **judge VERIFIED** (`astropy__astropy-12907`: gold→resolved, empty→failed) |
| Terminal-Bench | task pytest in container | scaffolded (contract + real preflight; harness wiring next) |
| AppWorld | programmatic state checker | scaffolded (contract + real preflight; harness wiring next) |

Disciplined order: **prove one benchmark's judge → wire the loop worker → A/B blind vs steering on a small subset → expand.** Get one real number before building more.

## Setup

```bash
python3 -m venv .venv && .venv/bin/pip install swebench   # SWE-bench harness
pnpm install                                              # tsx + link parent
# Docker daemon must be running (judges build/run per-instance images)
```

## Run

```bash
pnpm preflight                 # harness + Docker reachable?
pnpm verify-judge              # gold patch must RESOLVE, empty must FAIL (no model needed)
BENCH=terminal-bench pnpm preflight
# compare (blind vs steering) — once the worker is wired
```

Requires a model key for the worker (Tangle router `TANGLE_API_KEY`, or a direct provider). The judge needs only Docker.
