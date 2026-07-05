# agent-runtime examples

Runnable, single-file demos of what this library does: build agents, run several of them under one
budget, score them against a real check, and let them improve from their own runs. Every example
imports from the published package (`@tangle-network/agent-runtime`) exactly as your code would, and
most run **offline with no API key** so you can see the machinery before spending anything.

New here? Run these three, in order (the first two cost $0):

```bash
pnpm tsx examples/driver-loop/driver-loop.ts                  # 1. one agent steering another — offline
pnpm tsx examples/improve/improve.ts                          # 2. an agent that rewrites its own prompt, safely — offline
TANGLE_API_KEY=... pnpm tsx examples/supervise/supervise.ts   # 3. one function call = a supervisor over real workers
```

`driver-loop` is the core move everything else builds on; `improve` is the self-improvement primitive;
`supervise` is the one-call product entry point.

## A few words that appear everywhere

- **worker** — an agent that produces an answer.
- **driver** (or **supervisor**) — an agent that launches workers, reads their output, and decides
  what to do next.
- **the fold** — the key trick: a driver reads the last worker's output and writes the *next*
  instruction from it, so the loop actually reacts instead of retrying blind.
- **shot** — one worker attempt. **sample** = make N attempts and keep the best (breadth). **refine**
  = attempt, let a critic read what went wrong, steer the next attempt (depth).
- **check** — a function that scores an answer pass/fail. It is the ground truth every loop optimizes
  against.

---

## Start here — three self-contained demos

| # | Example | What it shows |
|---|---|---|
| 1 | [`chat-handler/`](./chat-handler/) | The full lifecycle of one product chat turn — the entry point every product wires. Offline. |
| 2 | [`strategy-suite/`](./strategy-suite/) | Compare ways of spending a compute budget (sample vs refine vs your own) against your own pass/fail check. Offline via an in-process fake model; `TANGLE_API_KEY` swaps in the real one. |
| 3 | [`recursive-supervisor/`](./recursive-supervisor/) | One agent spawns child agents on a single shared budget that refuses to overspend — shown by hand, then as a one-line helper. Offline. |

## The supervisor — one agent that runs other agents

| # | Example | What it shows |
|---|---|---|
| 4 | [`driver-loop/`](./driver-loop/) | **See the fold**: a driver reads the last worker's output and composes the next prompt from it (plan → run → decide → re-plan). Offline. |
| 5 | [`supervise/`](./supervise/) | The one-call headline: `supervise(profile, goal)` runs a full supervisor with everything defaulted. Needs `TANGLE_API_KEY`. |
| 6 | [`supervisor-loop/`](./supervisor-loop/) | The same supervisor over a real worker backend — cloud sandbox, local coding-CLI, or an MCP server — with the backend as the only knob you change. |
| 7 | [`delegate/`](./delegate/) | `delegate(intent)`: the supervisor writes and spawns a worker that does real work on disk, and the run only settles once the file it was asked to create actually exists. Needs `TANGLE_API_KEY`. |

## Benchmarking — score agents against a check

A round-based runner: plan tasks, run each in its own sandbox, parse and validate the output, decide,
repeat. A failing validator prunes a bad candidate so the loop can't keep it.

| # | Example | What it shows |
|---|---|---|
| 8 | [`researcher-loop/`](./researcher-loop/) | A research agent whose validator hard-fails if one tenant's data leaks into another's namespace, so the leak is pruned automatically. Needs the optional `@tangle-network/agent-knowledge` peer installed. |
| 9 | [`ui-audit/`](./ui-audit/) | The smallest end-to-end loop over a real browser (Playwright) with a stub judge, persisting the findings. |
| 9b | [`coding-benchmark/`](./coding-benchmark/) | Rank coding agents (Claude Code, opencode, Codex, a bare CLI) on real tasks with an **anti-cheat**: each agent is graded on hidden tests it never saw, so it can't hardcode the answer. Includes a secondary quality judge and real significance stats. Offline by default; `--live` uses real agent boxes. |
| 9c | [`webcode-matrix/`](./webcode-matrix/) | The real WebCode benchmark (Exa's 33-task dataset, graded by its own hidden tests) across a harness × model grid, rendered as a publishable leaderboard with charts, confidence bands, and pairwise significance. |

## Production plumbing — cost, streaming, telemetry

| # | Example | What it shows |
|---|---|---|
| 10 | [`knowledge-gating/`](./knowledge-gating/) | Stop an agent before it acts on facts it isn't confident about: the loop blocks when a required-knowledge confidence is below threshold. |
| 11 | [`runtime-run/`](./runtime-run/) | The run-record + cost-ledger you persist for dashboards — one row per run, any database. |
| 12 | [`stream-backends/`](./stream-backends/) | Pick where an agent's streaming output comes from (in-process iterator, cloud sandbox, or an OpenAI-compatible endpoint) behind one wire format. The OpenAI path needs `OPENAI_API_KEY`; the rest is offline. |
| 13 | [`sanitized-telemetry-streaming/`](./sanitized-telemetry-streaming/) | Log an agent's activity with user data redacted by default (and the one field that leaks PII if you opt out). |

## Hand work to another agent over MCP

| # | Example | What it shows |
|---|---|---|
| 14 | [`mcp-delegation/`](./mcp-delegation/) | Give any agent a "delegate this" button by mounting the agent-runtime MCP server: a `delegate` verb plus always-on status/history/feedback tools. Run `pnpm build` first so the local server binary exists. |
| 15 | [`fleet-delegation/`](./fleet-delegation/) | Set `TANGLE_FLEET_ID` to flip delegation from spawning a sibling sandbox to sharing one fleet workspace. Offline. |

## Self-improvement — agents that get better from their own runs

| # | Example | What it shows |
|---|---|---|
| 16 | [`strategy-evolution/`](./strategy-evolution/) | Full policy search with a safety gate: write new tactics from past losses, promote a champion only if a statistical test says the win isn't luck. Needs `TANGLE_API_KEY`. |
| 17 | [`improve/`](./improve/) | The one self-improvement verb: `improve(profile, findings)` rewrites a prompt and ships the new version only if it beats the old one on a held-out test set. Offline. |
| 17b | [`self-improving-coder/`](./self-improving-coder/) | The flywheel on a contamination-proof coding task: an agent writes strategies from its training losses, graded by real pytest, promoted only if a fresh holdout confirms the gain. `CALIBRATE=1` is a $0 no-key check. |
| 18 | [`self-improving-loop/`](./self-improving-loop/) | #17 unrolled step by step: v0 → judge → analyst → mutation → v1 → gate, showing which part owns each phase. Offline. |
| 19 | [`intelligence-recommend/`](./intelligence-recommend/) | The improvement loop offline end to end: read a run's trace → derive findings → `improve()` → a gated candidate. |
| 20 | [`intelligence-drop-in/`](./intelligence-drop-in/) | Wrap any agent with `withTangleIntelligence` to emit one trace per call — best-effort, and a proof that "off" is a zero-cost passthrough. |
| 20b | [`intelligence-webcode/`](./intelligence-webcode/) | The full observability SDK (billing boundary, effort tiers, per-tool cost breakdown, OTLP export) instrumented over every cell of the WebCode benchmark. Needs a sandbox key. |
| 21 | [`agents-of-all-shapes/`](./agents-of-all-shapes/) | Proof that any framework's traces converge on one open telemetry contract and produce one insight report. CI-tested. Offline. |
| 22 | [`product-eval/`](./product-eval/) | Test an agent against a simulated user: a persona holds a multi-round conversation, then the transcript is scored. Needs `TANGLE_API_KEY`. |
| 23 | [`agentic-data-creation/`](./agentic-data-creation/) | An agent manufactures **hard** training examples from a document and keeps only the ones that separate a strong solver from a weak one. Offline. |

## Research harnesses (not on the learning path)

| Example | What it shows |
|---|---|
| [`ablation-suite/`](./ablation-suite/) | The head-to-head behind the "supervisor beats raw compute by +20.8 points" result: three coordination styles compared cost-for-cost with a paired-bootstrap delta. Needs `TANGLE_API_KEY`; run `ARMS=cal` first (its README explains why). |

## Conventions

- Everything runs from this repo's `tsx`, so edits to the runtime are picked up immediately — no
  example creates its own throwaway `package.json`.
- Examples are synthetic and offline unless a row above says otherwise. The ones that need a key:
  `supervise`, `delegate`, `strategy-evolution`, `product-eval` (`TANGLE_API_KEY`); `stream-backends`'
  OpenAI path (`OPENAI_API_KEY`). `mcp-delegation` needs `pnpm build` first; `researcher-loop` needs
  the optional `@tangle-network/agent-knowledge` peer.
- Where a domain type is yours to provide (a sandbox box, an evidence store), the example defines a
  stub inline and comments mark which parts are *yours* vs the runtime's.

## Run everything, in learning order

From the repo root:

```bash
# Start here
pnpm tsx examples/chat-handler/chat-handler.ts
pnpm tsx examples/strategy-suite/strategy-suite.ts                 # offline; TANGLE_API_KEY swaps in the real model
pnpm tsx examples/recursive-supervisor/recursive-supervisor.ts

# The supervisor
pnpm tsx examples/driver-loop/driver-loop.ts                       # SEE THE FOLD (offline)
TANGLE_API_KEY=... pnpm tsx examples/supervise/supervise.ts
WORKER_BACKEND=bridge WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 \
  pnpm tsx examples/supervisor-loop/run.ts                         # one knob: bridge | sandbox
TANGLE_API_KEY=... pnpm tsx examples/delegate/delegate.ts

# Benchmarking
pnpm tsx examples/researcher-loop/researcher-loop.ts               # needs the agent-knowledge peer
pnpm dlx tsx examples/ui-audit/ui-audit.ts /tmp/ui-audit-demo https://example.com
pnpm tsx examples/coding-benchmark/benchmark.ts                    # offline
pnpm tsx examples/coding-benchmark/benchmark.ts --ensemble --reps 5

# Production plumbing
pnpm tsx examples/knowledge-gating/knowledge-gating.ts
pnpm tsx examples/runtime-run/runtime-run.ts
pnpm tsx examples/stream-backends/stream-backends.ts
pnpm tsx examples/sanitized-telemetry-streaming/sanitized-telemetry-streaming.ts

# Delegation over MCP
pnpm build  # mcp-delegation needs dist/mcp/bin.js
pnpm tsx examples/mcp-delegation/mcp-delegation.ts
pnpm tsx examples/fleet-delegation/fleet-delegation.ts

# Self-improvement
TANGLE_API_KEY=... pnpm tsx examples/strategy-evolution/strategy-evolution.ts
pnpm tsx examples/improve/improve.ts
CALIBRATE=1 pnpm tsx examples/self-improving-coder/self-improving-coder.ts   # $0 no-key check
pnpm tsx examples/self-improving-loop/self-improving-loop.ts
pnpm tsx examples/intelligence-recommend/intelligence-recommend.ts
pnpm tsx examples/intelligence-drop-in/intelligence-drop-in.ts
pnpm tsx examples/agents-of-all-shapes/run.ts
TANGLE_API_KEY=... pnpm tsx examples/product-eval/product-eval.ts
pnpm tsx examples/agentic-data-creation/run.ts
```

## Tracing

Every loop emits `loop.*` trace events. Set `OTEL_EXPORTER_OTLP_ENDPOINT` and they export as standard
OpenTelemetry GenAI spans — the same open format any observability backend reads. Example #21
(`agents-of-all-shapes`) shows the traces-to-insights pipe end to end.
