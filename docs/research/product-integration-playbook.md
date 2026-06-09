> **Track:** Operations (research) · **Role:** integration + operator playbook · **Status:** actionable — primitives mostly shipped, three packaging gaps named

# Product integration playbook — putting the optimization system into the products

The step-by-step path for wiring the optimization system (canonical Supervisor loop ·
`observe()` analyst · Environment/Strategy/`runBenchmark` · corpus) into the live
agent-app products (gtm / tax / creative / legal / agent-builder), and **what the
operator (Drew + team) does at each step** vs what runs autonomously.

Honest framing up front: most of the production loop **already ships** in agent-eval /
agent-runtime (the `agent-stack-adoption` 9-phase pipeline). What this playbook adds is
(a) where the *new* optimization suite slots into that pipeline, (b) the operator role
table, (c) the three packaging gaps that block "just import it" today.

## The three packaging gaps (do these first)

| gap | today | needed |
|---|---|---|
| **G1 — the suite isn't published.** `Environment`, `Strategy`, `defineStrategy`, `runBenchmark`, the canonical depth/breadth drivers live in `bench/src/` (R&D workspace), not in the published `@tangle-network/agent-runtime` exports. | products can't import them | lift `agentic.ts` + `run-benchmark.mts` into `src/` behind `/loops` (a `substrate-release` motion; the code is already domain-blind) |
| **G2 — corpus has no production inflow.** `observe()`/`Corpus` runs in bench loops; production traces flow to the trace sink + (optionally) OTLP, but nothing turns production traces into corpus facts automatically. | analyst-loop proposes; PR-gated | a production `observe()` pass over the trace sink (batch, nightly) writing corpus facts; later the Intelligence-served corpus (layer-intelligence-serving) |
| **G3 — no product `Environment` exists.** The gate has only gym Environments. | gym-only evidence | one product Environment (gtm first): tools = the product's real MCP surface; `score()` = a deployable domain check |

## The integration sequence (one product: gtm-agent)

Assumes the product is already at adoption Phase 3+ (composer + trace sink + nightly
eval live — gtm is). Each step names the existing primitive; nothing here is invented.

1. **Parity profile** — eval runs the *production* agent: `composeProductionAgentProfile`
   → `createSandboxAct`. (Shipped; most products wired.) *Operator: none.*
2. **Production traces flowing** — `createProductionTraceSink` on every chat turn; OTLP
   export to Intelligence optional but recommended (`createOtelExporter`). *Operator:
   set the OTLP endpoint secret once; glance at trace health weekly.*
3. **The product Environment (G3)** — implement the 5 hooks over gtm's real surface:
   `open` = a scoped workspace/session; `tools` = the product MCP tools; `call` =
   invoke them; `score` = a deployable check (campaign-state assertions, not an LLM
   judge); `close` = teardown. ~1–2 days; this is the gym→product bridge experiment
   from `layer-domain-generality.md`. *Operator decision: which checks define "done"
   for a gtm task — this is product judgment, not engineering.*
4. **Run the gate on the product** — `runBenchmark({environment: gtmEnv, strategies:
   [sample, refine], …})` over a frozen scenario set. First output: does depth/steering
   pay on *your* domain, with the (correct, $, ms) vector per layer-economics.
   *Operator: review the report; pick the strategy+model cell for production.*
5. **Backend integrity + scorecard + ship-gate** — `assertRealBackend` before any
   verdict; `recordRunsToScorecard`/`diffScorecard` per commit; `runProductionLoop`'s
   held-out promotion gate for any prompt/addendum change. (All shipped.) *Operator:
   approve/reject gate-passing PRs — this is the standing human checkpoint.*
6. **Corpus priming (G2 + the across-run layer)** — nightly `observe()` over the day's
   production traces → corpus; prime tomorrow's runs via `corpus.query`. Run
   primed-vs-cold on the product scenario set — the product-grade flywheel test.
   *Operator: review high-confidence facts weekly (a 10-minute curation pass); approve
   the auto-apply threshold.*
7. **Intelligence hookup** — keep exporting (step 2 covers it). When the served-findings
   read-back exists (layer-intelligence-serving), swap `FileCorpus` for the
   Intelligence-backed `Corpus` — one port, no loop changes. *Operator: tenant config.*
8. **CI crons** — nightly eval + weekly production-loop (templates shipped in the
   adoption skills). *Operator: provision the runner once; rotate secrets; review the
   weekly auto-PR.*

## The operator role, consolidated

What **only humans** do — everything else runs autonomously:

| cadence | action | authority |
|---|---|---|
| once per product | define the deployable checks (step 3) + holdout scenarios | product judgment — the single highest-leverage human input |
| once | set gate thresholds (paired-delta, overfit gap), budgets, model allowlist | risk posture |
| weekly | review scorecard diff + the production-loop auto-PR; approve/reject | the ship decision |
| weekly | 10-min corpus curation (high-confidence facts in/out) | knowledge quality |
| on failure | backend-integrity or infra alerts (stub verdict, runner down) | unblock |

The deliberate design: the human owns **what "good" means** (checks, thresholds,
scenarios) and **the ship decision**; the system owns everything between — running,
scoring, mutating, gating, reporting. That is the operator contract to staff for: not
babysitting runs, but curating definitions and reviewing one diff per product per week.

## Sequencing across the fleet

gtm first (richest tools, live traces, friendliest checks) → then tax (high-value
deterministic checks: return validation) → creative/legal (checks are harder to make
deterministic — may stay at steps 1–2+5 until eval-agent rubrics mature) →
agent-builder (special case: its *product* is generating agents, so the strategy-author
skill from `layer-agent-authored.md` is its feature, not its tooling).

## What NOT to do

- Don't fork `runProductionLoop` per product to get custom topologies — that's G1's
  job (publish `Strategy`), then strategies are injected, not forked.
- Don't auto-apply corpus facts above the measured-precision threshold; PR-gate until
  the primed-vs-cold A/B shows lift.
- Don't ship any steering default to a product before its own Environment gate (step 4)
  shows it pays *on that domain* — the boundary law says it may not.
