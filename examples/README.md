# agent-runtime examples

A learning path. Read the examples in order — each one adds a single concept on top of the last.
The fastest way to feel the package is to read **ONE** example: [`driver-loop/`](./driver-loop/)
(below), which shows the move every supervisor is built on.

Every example imports from `@tangle-network/agent-runtime` (the surface consumers use), not from
relative paths, and they are typechecked by `pnpm run typecheck:examples` — except `researcher-loop`,
which needs the optional `@tangle-network/agent-knowledge` peer that agent-runtime doesn't depend on
and CI doesn't install, so it is excluded from that typecheck (run it with `agent-knowledge` installed).

## Quickstart — run these three (≈5 min, two run offline)

Get the feel before reading the full map. In order:

```bash
pnpm tsx examples/driver-loop/driver-loop.ts                  # SEE THE FOLD — offline, no creds
TANGLE_API_KEY=... pnpm tsx examples/supervise/supervise.ts   # one-call supervisor over real workers
pnpm tsx examples/improve/improve.ts                          # the gated self-improvement verb — offline
```

`driver-loop` is the one move everything else is built on; `supervise` is the one-call product entry;
`improve` is the one self-improvement verb. The full learning path is below.

## Vocabulary

These words appear in every example. The clearest demonstration of all of them is
[`driver-loop/`](./driver-loop/).

- **round** — one driver cycle: `plan → run workers → decide` (the `runLoop` kernel runs this once per round).
- **shot** — one independent worker attempt/sample; **multishot** plays N shots in parallel.
- **sample** — best-of-N shots (breadth); **refine** — iterate-with-critique across rounds (depth).
- **the fold** — a driver reading the last worker's output and writing the next instruction *from* it.

## Tier 0 — the three cores (read one, feel the power)

| # | Example | Use this when… |
|---|---|---|
| 1 | [`chat-handler/`](./chat-handler/) | You're wiring a product's chat turn — the `handleChatTurn` lifecycle every product runs. |
| 2 | [`strategy-suite/`](./strategy-suite/) | You want to compare optimization strategies (sample vs refine vs your own) against your own pass/fail check (offline via an in-process mock router; `TANGLE_API_KEY` swaps in the live router). |
| 3 | [`recursive-supervisor/`](./recursive-supervisor/) | You want the raw recursive atom: one `Agent` spawning children on a conserved budget pool, shown twice (raw `scope.spawn` + the `fanout` combinator, offline). |

## Tier 1 — the driver loop & supervisor (the heart of the product)

| # | Example | Use this when… |
|---|---|---|
| 4 | [`driver-loop/`](./driver-loop/) | **You want to SEE the fold** — a driver reads the last worker's output and composes the next prompt from it (plan → run → decide → re-plan). The seam that makes everything else click. Offline. |
| 5 | [`supervise/`](./supervise/) | You want the one-call headline: `supervise(profile, goal)` — a router-brained supervisor with all scaffolding defaulted (needs `TANGLE_API_KEY`). |
| 6 | [`supervisor-loop/`](./supervisor-loop/) | You want that same supervisor over a real worker backend — sandbox box / local cli-bridge / coordination MCP — with the **worker backend as the only knob**. |
| 7 | [`delegate/`](./delegate/) | You want the one-call `delegate(intent)`: the supervisor authors + spawns a worker that does real on-disk filesystem work, the gate settles only when the file exists, cost rides through (needs `TANGLE_API_KEY`). |

## Tier 2 — the runLoop kernel (the leaf the benches drive)

The round-synchronous kernel: `driver.plan()` → N tasks → one sandbox per iteration → `output.parse`
→ `validator.validate` → `driver.decide`. The drivers below are single-round and content-blind on
purpose — read [`driver-loop/`](./driver-loop/) for the contrast (a driver that re-plans from output).

| # | Example | Use this when… |
|---|---|---|
| 8 | [`researcher-loop/`](./researcher-loop/) | You want the canonical `runLoop` + inline fanout driver, with a validator that hard-fails a namespace leak so the kernel prunes the bad candidate (needs the optional `@tangle-network/agent-knowledge` peer). |
| 9 | [`ui-audit/`](./ui-audit/) | You want the smallest end-to-end `runLoop` over a real client (Playwright + stub judge), persisting findings. |
| 9a | `agent-eval/examples/eval-fixtures-quickstart` | You want Vercel-style eval folders (`PROMPT.md` + `EVAL.ts`) to run through runtime's `runLoop`; pair `loadEvalFixtureScenarios()` with `loopCampaignDispatch()`. |
| 9b | [`coding-benchmark/`](./coding-benchmark/) | You want a scientifically-rigorous coding benchmark across harnesses: `runProfileMatrix` over harness × baseline-profile × scenario, a one-line tool knob (websearch / webfetch / MCP), a held-out-test-execution anti-cheat (the agent is graded on hidden tests it never saw, so it can't hardcode), a secondary quality judge, and paired-bootstrap + Wilson + BH stats (offline by default; `--live` for real harness boxes). |

## Tier 3 — the production runtime, deeper

| # | Example | Use this when… |
|---|---|---|
| 10 | [`knowledge-gating/`](./knowledge-gating/) | You want readiness gating: the loop BLOCKS when a required-knowledge confidence is below threshold (also the smallest `runAgentTask`). |
| 11 | [`runtime-run/`](./runtime-run/) | You want the run-record + cost-ledger persistence lifecycle for dashboards. |
| 12 | [`stream-backends/`](./stream-backends/) | You want to pick a stream transport (iterable / sandbox / OpenAI-compatible) — the "pick your backend" map (OpenAI section needs `OPENAI_API_KEY`). |
| 13 | [`sanitized-telemetry-streaming/`](./sanitized-telemetry-streaming/) | You want redaction-by-default telemetry on the stream (and the `task.intent` PII footgun). |

## Tier 4 — delegation over MCP

| # | Example | Use this when… |
|---|---|---|
| 14 | [`mcp-delegation/`](./mcp-delegation/) | You want to mount `agent-runtime-mcp` in an `AgentProfile`. Exposes the generic `delegate` verb (opt in with `MCP_ENABLE_DELEGATE=1`) plus the always-on `delegate_feedback` / `delegation_status` / `delegation_history` trio (and `delegate_ui_audit` when a UI-audit runner is wired). Needs `pnpm build` first. |
| 15 | [`fleet-delegation/`](./fleet-delegation/) | You want `TANGLE_FLEET_ID` to flip delegation from sibling-sandbox to fleet-workspace topology. |

## Tier 5 — self-improvement & intelligence

| # | Example | Use this when… |
|---|---|---|
| 16 | [`strategy-evolution/`](./strategy-evolution/) | You want the full policy-search + holdout gate: author candidates from losses, promote a champion only if a paired-bootstrap CI says it isn't luck (needs `TANGLE_API_KEY`). |
| 17 | [`improve/`](./improve/) | You want the one supported RSI verb: `improve(profile, findings, opts)` — optimize one profile surface, ship only if it clears the held-out gate. Offline. |
| 18 | [`self-improving-loop/`](./self-improving-loop/) | You want the unrolled internals of #17: v0 → judge → analyst → mutation → v1 → gate, with the "which substrate owns each phase" map. Offline. |
| 19 | [`intelligence-recommend/`](./intelligence-recommend/) | You want the intelligence loop offline: trace → findings → `improve()` → gated candidate. |
| 20 | [`intelligence-drop-in/`](./intelligence-drop-in/) | You want to wrap any agent with `withTangleIntelligence` and ship one trace per call (best-effort; off = passthrough). |
| 21 | [`agents-of-all-shapes/`](./agents-of-all-shapes/) | You want proof that any framework's traces converge on one OTel contract → one `InsightReport` (the CI-tested example). |
| 22 | [`product-eval/`](./product-eval/) | You want user-sim product evals: a persona over a multi-round conversation via `runPersonaConversation`, then score the transcript (`maxTurns` is a ceiling, not a target). Needs `TANGLE_API_KEY`; offline via a `backendFor` override. |
| 23 | [`agentic-data-creation/`](./agentic-data-creation/) | You want the **Autodata inner loop**: an agent manufactures HARD training examples from a doc and keeps only the ones that DISCRIMINATE a strong solver from a weak one. Composes the fold (`runLoop`+refine driver), N× sampling (`runLoop`+fanout driver), `llmJudge`, `CostLedger`, and `Corpus`; the one new piece is `discriminativeAcceptRule`. Shows the calibration (plain gap ≈ 0.02 vs agentic ≈ 0.31). Offline. |

## Conventions

- Examples are synthetic unless noted. `strategy-evolution`, `product-eval`, `supervise`, and
  `delegate` need `TANGLE_API_KEY` (`strategy-suite` and `product-eval` also run offline — the
  former on an in-process mock router, the latter via a `backendFor` override); `stream-backends`'
  OpenAI section needs `OPENAI_API_KEY` (the rest runs offline); `mcp-delegation` needs `pnpm build` first so the local
  MCP bin exists; `researcher-loop` needs the optional `@tangle-network/agent-knowledge` peer.
  Everything else runs fully offline.
- Where domain types are needed (`SandboxBox`, evidence stores), the example defines them inline —
  comments call out which parts are *yours* to provide vs *the runtime's* contract.
- No example creates its own throwaway `package.json` — they run from this repo's tsx so changes to
  the runtime are picked up immediately.

## Run

From the agent-runtime repo root, in the learning order above:

```bash
# Tier 0 — the three cores
pnpm tsx examples/chat-handler/chat-handler.ts
pnpm tsx examples/strategy-suite/strategy-suite.ts                 # offline (mock worker); TANGLE_API_KEY swaps in the live router
pnpm tsx examples/recursive-supervisor/recursive-supervisor.ts

# Tier 1 — driver loop & supervisor (the heart)
pnpm tsx examples/driver-loop/driver-loop.ts                       # SEE THE FOLD (offline)
TANGLE_API_KEY=... pnpm tsx examples/supervise/supervise.ts        # the one-call supervisor
WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 \
  pnpm tsx examples/supervisor-loop/run-bridge.ts                  # same supervisor, local cli-bridge backend
TANGLE_API_KEY=... pnpm tsx examples/delegate/delegate.ts          # delegate(intent), one call

# Tier 2 — the runLoop kernel
pnpm tsx examples/researcher-loop/researcher-loop.ts
pnpm dlx tsx examples/ui-audit/ui-audit.ts /tmp/ui-audit-demo https://example.com
pnpm tsx examples/coding-benchmark/benchmark.ts                     # harness × profile × scenario (offline)
pnpm tsx examples/coding-benchmark/benchmark.ts --ensemble --reps 5 # 3-model judge panel + more reps

# Tier 3 — production runtime, deeper
pnpm tsx examples/knowledge-gating/knowledge-gating.ts
pnpm tsx examples/runtime-run/runtime-run.ts
pnpm tsx examples/stream-backends/stream-backends.ts
pnpm tsx examples/sanitized-telemetry-streaming/sanitized-telemetry-streaming.ts

# Tier 4 — delegation over MCP
pnpm build  # mcp-delegation needs dist/mcp/bin.js
pnpm tsx examples/mcp-delegation/mcp-delegation.ts
pnpm tsx examples/fleet-delegation/fleet-delegation.ts

# Tier 5 — self-improvement & intelligence
TANGLE_API_KEY=... pnpm tsx examples/strategy-evolution/strategy-evolution.ts
pnpm tsx examples/improve/improve.ts
pnpm tsx examples/self-improving-loop/self-improving-loop.ts
pnpm tsx examples/intelligence-recommend/intelligence-recommend.ts
pnpm tsx examples/intelligence-drop-in/intelligence-drop-in.ts
pnpm tsx examples/agents-of-all-shapes/run.ts
TANGLE_API_KEY=... pnpm tsx examples/product-eval/product-eval.ts
pnpm tsx examples/agentic-data-creation/run.ts                      # Autodata inner loop (offline)
```

## Tracing

The kernels emit `loop.*` trace events as they run; with `OTEL_EXPORTER_OTLP_ENDPOINT` set they
export as OTel GenAI spans (see the root README § Tracing). `agents-of-all-shapes/` (#21) shows the
full traces → insights pipe; the `agent-stack-adoption` skill documents the end-to-end production
ingestion pipeline.
