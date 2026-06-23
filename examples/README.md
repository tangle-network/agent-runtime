# agent-runtime examples

Ordered as a learning progression — each example introduces one concept on top of the previous one. The first three cover the package's three cores: the production chat/task runtime, the optimization suite, and the recursive Supervisor. The rest go deeper into each.

Every example imports from `@tangle-network/agent-runtime` (the same surface consumers use), not from relative paths. All of them are typechecked by `pnpm run typecheck:examples` (wired into `pnpm run typecheck`).

Era tags: **production runtime** (`runAgentTask` / `handleChatTurn` — what every product runs), **loops suite** (`Environment` / `defineStrategy` / `runBenchmark` — the optimization layer), **supervisor core** (`Scope` / `Supervisor` / personify — the recursive atom; prefer it for new recursive work), **runLoop kernel** (the round-synchronous driver loop), **infra** (transports, MCP, observability).

## Start here — the three cores

| # | Example | Era | One sentence |
|---|---|---|---|
| 1 | [`chat-handler/`](./chat-handler/) | production runtime | `handleChatTurn` — the production chat turn lifecycle every product runs |
| 2 | [`strategy-suite/`](./strategy-suite/) | loops suite | `Environment` + `defineStrategy` + `runBenchmark` — author and compare optimization strategies against your own check (needs `TANGLE_API_KEY`) |
| 3 | [`recursive-supervisor/`](./recursive-supervisor/) | supervisor core | One `Agent` spawning children through `scope.spawn` on a conserved budget pool, plus the `fanout` combinator (offline) |

## The production runtime, deeper

| # | Example | Era | One sentence |
|---|---|---|---|
| 4 | [`knowledge-gating/`](./knowledge-gating/) | production runtime | The minimal `AgentAdapter` + `requiredKnowledge` + readiness gating |
| 5 | [`sanitized-telemetry-streaming/`](./sanitized-telemetry-streaming/) | production runtime | Redaction-by-default telemetry collectors (streaming + non-streaming) |
| 6 | [`runtime-run/`](./runtime-run/) | production runtime | `startRuntimeRun` + cost ledger persistence |
| 7 | [`stream-backends/`](./stream-backends/) | infra | The three stream transports (iterable / sandbox / OpenAI-compatible) + SSE helpers, side by side |

## Delegation + tools

| # | Example | Era | One sentence |
|---|---|---|---|
| 8 | [`mcp-delegation/`](./mcp-delegation/) | infra | Mount `agent-runtime-mcp` in an `AgentProfile` — exposes `delegate_code`, `delegate_research`, `delegate_feedback`, `delegation_status`, `delegation_history` (plus `delegate_ui_audit` when a UI-audit runner is wired) |
| 9 | [`fleet-delegation/`](./fleet-delegation/) | infra | `TANGLE_FLEET_ID` flips delegation from sibling-sandbox to fleet-workspace topology |

## The loops suite, deeper — search, evals, and the RSI verb

| # | Example | Era | One sentence |
|---|---|---|---|
| 9c | [`strategy-evolution/`](./strategy-evolution/) | loops suite | `runStrategyEvolution` + `promotionGate` — the policy-search journey: author candidate strategies from losses, advance a champion, promote on a fresh holdout slice (needs `TANGLE_API_KEY`) |
| 9d | [`product-eval/`](./product-eval/) | loops suite | `evalPersona` — user-sim product evals in one call: scripted + LLM-adversarial personas, plus the `runPersonaDispatch` → `runProfileMatrix` scored path (needs `TANGLE_API_KEY`; offline-testable via a `backendFor` override) |
| 9e | [`coding-benchmark/`](./coding-benchmark/) | loops suite | `runProfileMatrix` over harness × baseline-profile × scenario — one coding task across claude-code / opencode / codex / cli, with a one-line tool knob, validators-before-judge, a no-cheat firewall, and real paired-bootstrap + Wilson + BH stats (offline by default; `--live` for real harness boxes) |

## The supervisor core, deeper — an agent drives N agents

| # | Example | Era | One sentence |
|---|---|---|---|
| 9b | [`supervisor-loop/`](./supervisor-loop/) | supervisor core | One LLM SUPERVISOR (`driverAgent`) spawns + drives N worker agents to a checked completion on one conserved pool — the SAME code over `router-tools` / `sandbox` (a box) / `bridge` (local cli-bridge), swapping only the worker-leaf seam |

## The runLoop kernel (driver-planned fanout)

The round-synchronous kernel: `driver.plan()` → N tasks → one sandbox per iteration → parse → validate → `driver.decide`. The drivers below are hand-written inline (`plan` + `decide` — two functions); for new recursive work prefer the supervisor core (#3).

| # | Example | Era | One sentence |
|---|---|---|---|
| 10 | [`coder-loop/`](./coder-loop/) | runLoop kernel | `coderProfile` + `runLoop` + an inline fanout driver — kernel picks the winner |
| 11 | [`researcher-loop/`](./researcher-loop/) | runLoop kernel | `researcherProfile` (from `@tangle-network/agent-knowledge/profiles`) + the namespace-leak hard-fail validator |
| 12 | [`ui-audit/`](./ui-audit/) | runLoop kernel | `uiAuditorProfile` + an in-process `SandboxClient` (Playwright + stub judge) + Markdown findings writer |

## Self-improvement + observability

| # | Example | Era | One sentence |
|---|---|---|---|
| 13 | [`self-improving-loop/`](./self-improving-loop/) | loops suite (pedagogical) | The v0 → judge → analyst → mutation → v1 → gate cycle, offline; production paths are `selfImprove` (agent-eval) and `runStrategyEvolution` (#2's subpath) |
| 13b | [`improve/`](./improve/) | loops suite | `improve(profile, findings, opts)` — the one pluggable RSI verb (held-out-gated surface optimization), offline with a scripted generator |
| 13c | [`intelligence-recommend/`](./intelligence-recommend/) | loops suite | The intelligence loop end to end, offline: `recordTrace` → derived `AnalystFinding`s → `improve()` → a gated candidate (the first example connecting the two halves) |
| 14 | [`agents-of-all-shapes/`](./agents-of-all-shapes/) | infra | Any framework's traces → one OTel GenAI contract → in-process `InsightReport` (the only example with a CI test) |

## Conventions

- Examples are synthetic unless noted. `strategy-suite`, `strategy-evolution`, and `product-eval` need `TANGLE_API_KEY` (`improve` and `intelligence-recommend` run fully offline); `stream-backends`' OpenAI section needs `OPENAI_API_KEY` (the rest of it runs offline); `mcp-delegation` needs `pnpm build` first so the local MCP bin exists; `researcher-loop` needs the optional `@tangle-network/agent-knowledge` peer.
- Where domain types are needed (`SandboxBox`, evidence stores), the example defines them inline — comments call out which parts are *yours* to provide vs *the runtime's* contract.
- No example creates its own throwaway `package.json` — they run from this repo's tsx so changes to the runtime are picked up immediately.

## Run

From the agent-runtime repo root, in the suggested learning order:

```bash
# The three cores
pnpm tsx examples/chat-handler/chat-handler.ts
TANGLE_API_KEY=... pnpm tsx examples/strategy-suite/strategy-suite.ts
pnpm tsx examples/recursive-supervisor/recursive-supervisor.ts

# Production runtime, deeper
pnpm tsx examples/knowledge-gating/knowledge-gating.ts
pnpm tsx examples/sanitized-telemetry-streaming/sanitized-telemetry-streaming.ts
pnpm tsx examples/runtime-run/runtime-run.ts
pnpm tsx examples/stream-backends/stream-backends.ts

# Delegation
pnpm build  # mcp-delegation needs dist/mcp/bin.js
pnpm tsx examples/mcp-delegation/mcp-delegation.ts
pnpm tsx examples/fleet-delegation/fleet-delegation.ts

# Supervisor core, deeper — one agent drives N workers (bridge = local cli-bridge path)
TANGLE_API_KEY=... pnpm tsx examples/supervise/supervise.ts   # router brain + router-tools workers (the one-call entry)
WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 pnpm tsx examples/supervisor-loop/run-bridge.ts  # local harness CLIs via ~/code/cli-bridge

# runLoop kernel
pnpm tsx examples/coder-loop/coder-loop.ts
pnpm tsx examples/researcher-loop/researcher-loop.ts
pnpm dlx tsx examples/ui-audit/ui-audit.ts /tmp/ui-audit-demo https://example.com

# The loops suite, deeper — search + evals
TANGLE_API_KEY=... pnpm tsx examples/strategy-evolution/strategy-evolution.ts  # policy search → holdout gate
TANGLE_API_KEY=... pnpm tsx examples/product-eval/product-eval.ts              # user-sim product evals (evalPersona)
pnpm tsx examples/coding-benchmark/benchmark.ts                               # harness × profile × scenario matrix (offline)
pnpm tsx examples/coding-benchmark/benchmark.ts --ensemble --reps 5           # 3-model judge + more reps

# Self-improvement + observability
pnpm tsx examples/self-improving-loop/self-improving-loop.ts
pnpm tsx examples/improve/improve.ts                                   # improve() — the RSI verb (offline)
pnpm tsx examples/intelligence-recommend/intelligence-recommend.ts    # traces → findings → improve() (offline)
pnpm tsx examples/agents-of-all-shapes/run.ts
```

## Tracing

The kernels emit `loop.*` trace events as they run; with `OTEL_EXPORTER_OTLP_ENDPOINT` set they export as OTel GenAI spans (see the root README § Tracing). `agents-of-all-shapes/` (#14) shows the full traces → insights pipe; the `agent-stack-adoption` skill documents the end-to-end production ingestion pipeline.
