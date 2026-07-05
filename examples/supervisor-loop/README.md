# One supervisor, workers that run anywhere — change one setting

A supervisor agent splits a job into pieces and hands each to a worker agent. Here the *same*
supervisor code runs its workers two ways — as real command-line coding agents on your machine, or in
fresh cloud sandboxes — and the only thing you change is one environment variable, `WORKER_BACKEND`.
Every worker's result counts only when a real check passes on its output, never because the worker said
"done."

## Why it matters

You want to build and debug an agent system locally, then run it at scale in the cloud, without
rewriting it. This proves that: develop against local CLI agents (`bridge`), then flip
`WORKER_BACKEND=sandbox` and the identical supervisor drives workers in real cloud boxes — zero code
change.

## Run

Build once (the examples import the built package), then pick a backend:

```bash
pnpm build

# Workers = real local coding CLIs (claude-code / codex / opencode / …), via a local bridge:
WORKER_BACKEND=bridge WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 \
  pnpm tsx examples/supervisor-loop/run.ts

# The SAME code, workers in real cloud boxes:
WORKER_BACKEND=sandbox TANGLE_API_KEY=sk-… SANDBOX_BASE_URL=https://… \
  pnpm tsx examples/supervisor-loop/run.ts
```

For a $0, no-network wiring check (no agents, no key), two unit tests cover the
spawn → wait → checked-settle loop:

```bash
pnpm test tests/loops/coordination-driver.test.ts tests/supervisor-loop-example.test.ts
```

## Three runners

| file | what it shows |
|---|---|
| `run.ts` | the one-call supervisor. `WORKER_BACKEND=bridge` \| `sandbox` is the only knob. |
| `run-supervisor-mcp.ts` | the harness-native path: a coding agent *is* the supervisor and calls a real `spawn_agent` tool to launch workers — a box driving boxes, no scripted driver. |
| `shared.ts` | the demo goal, the pass/fail check, and the two helpers that make the one-knob swap real. |

## The pieces, in plain terms

- **`WORKER_BACKEND`** — the one knob. `bridge` = local CLI agents behind one HTTP endpoint (needs a
  running `cli-bridge`, below); `sandbox` = real cloud boxes (needs `TANGLE_API_KEY` + `SANDBOX_BASE_URL`).
- **the check** — a worker is "done" only when its output passes a real, deterministic check (here: the
  output must contain `ANSWER=42`), read off the worker's actual output. No model grades itself.
- **the supervisor's brain** — with a router key, a real model reasons the plan → spawn → stop loop;
  without one, a fixed script drives the wiring so the example runs offline.
- **budget** — every worker draws from one shared, capped compute budget, so the whole tree can't overspend.

## The local bridge

`bridge` runs real coding CLIs on your machine behind one OpenAI-compatible endpoint — no cloud needed.
Start it, then point a worker at it:

```bash
cd ~/code/cli-bridge && pnpm install && pnpm install:harness -- opencode && pnpm start   # → http://127.0.0.1:3344
WORKER_BACKEND=bridge WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 \
  pnpm tsx examples/supervisor-loop/run.ts
```

The workflow: prove the supervisor topology against local CLIs (`bridge`), then point it at real boxes
(`sandbox`) with zero code change — only the worker seam differs.
