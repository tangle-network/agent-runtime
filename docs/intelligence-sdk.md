> **Track:** Reference · **Role:** product SDK contract · **Status:** target interface — current primitives exist, wrapper not fully shipped. **Post-2026-06-13 evidence reset** (see `docs/go-live-plan.md`): the quality-improvement framing is retracted; this SDK sells **cost + verification + transfer**, not "makes your agent smarter."

# Tangle Intelligence SDK

## The honest claim (and the banned overclaim)

The only customer claim the evidence backs: **"Verified improvements, not lucky streaks — and we hold your quality at lower cost."** Two replicated survivors: certification rigor predicts transfer (gate-certified artifacts transfer, +31.7/+36.7pp holdout, twice); the cost flywheel (certified memory + compression hold quality at −12 to −31% cost).

**DO-NOT-CLAIM (normative — these strings must not reach a customer surface):**
1. ✗ "makes your agent smarter / better / higher-quality than just running it" — the depth>breadth keystone collapsed to a tie (+4.1pp CI[−1.6,+10.2] at n=72); at equal compute, compute dominates and cleverness is marginal.
2. ✗ any single-number quality lift ("+16.4pp", "depth beats breadth") — the n=16 headline was an underpowered streak.
3. ✗ "Verified PRs improve your agent" — a passing-checks PR proves **non-regression on the customer's n**, not improvement. This mode is **"Gated PRs / Verified-Safe PRs."**
4. ✗ "self-improving / learns and gets better over time" — accumulation is unproven (in-stream admission is dead, E3c/E3d); only selection of one certified artifact is real.

**Escape hatch — the ONLY path to an "improved" claim:** a full-statistical-gate certificate (held-out, paired-bootstrap CI lower-bound > 0, blind reproducer, n ≥ power floor, BH-corrected) with CI + n attached. Gate-passing alone earns only the non-regression claim.

## Mode 0 — intelligence OFF (the billing floor)

Below Observe sits **OFF**: the agent runs in a sandbox and streams output on the box-provisioned router credential, paying **inference + sandbox compute only** — no analysts, corpus, loops, or lifecycle. Intelligence is the paid add-on; OFF is the honest baseline the cost claim is measured against, the fail-closed degrade target, and the default. Billing law: **the billing line falls on the spawn line** — base-stream tokens bill `inferenceUsd`; every intelligence spawn bills a distinct `intelligenceUsd` channel, and `'off'` ⇒ `intelligenceUsd: 0` refuses every intelligence spawn at `reserve()` while the base stream runs untouched. Tiers: `off | eco | standard | thorough | max` (maps to #268 EffortPolicy).

**Product fail-closed ≠ experiment fail-closed:** behavior-changing intelligence (analyst steer, candidate promotion) fails closed by **not running and letting the base stream return** — never by aborting the user's turn (the experiment harness's hard-abort in `createScopeAnalyst` is correct for research, wrong for a product OFF tier).

This is the product contract for the integration Drew is asking for: an agent team should wrap an existing agent, ship traces to Tangle Intelligence, receive recommendations, and eventually merge verified improvement PRs without becoming eval engineers.

The SDK should feel like this:

```ts
import { withTangleIntelligence } from '@tangle-network/agent-runtime/intelligence'

export const agent = withTangleIntelligence(myAgent, {
  project: 'legal-agent',
  apiKey: process.env.TANGLE_API_KEY,
  repo: { owner: 'acme', name: 'legal-agent', baseBranch: 'main' },
  checks: ['pnpm test', 'pnpm typecheck'],
  surfaces: ['src/agent/**', 'src/tools/**', 'skills/**'],
})
```

The user should not start by writing holdouts, custom judges, GEPA campaigns, trace stores, or production-loop crons. Those are power-user configuration levels behind the wrapper.

## Product Promise

The plain promise:

1. Wrap your existing agent.
2. Keep running your product.
3. Send traces, costs, outcomes, and failures to Intelligence.
4. Get failure clusters and recommended improvements.
5. When you provide checks and mutable surfaces, get verified PRs.
6. When you are ready, opt into scheduled loops, custom gates, and advanced evals.

This repo already contains many of the substrate pieces: `handleChatTurn`, `createOtelExporter`, `exportEvalRuns`, `defineAgent`, `runAnalystLoop`, `improvementDriver`, `agenticGenerator`, promotion gates, and loop drivers. The missing product layer is the small wrapper and the opinionated defaults.

## Adoption Modes

| Mode | Customer Code | Platform Output | Required Inputs | Safe Default |
|---|---:|---|---|---|
| Observe | 10-50 LOC | traces, costs, failures, dashboard | project id, API key, entrypoint | best-effort export |
| Recommend | 50-100 LOC | failure clusters, suggestions, issues/reports | traces, outcome mapping | human review |
| Verified PRs | 100-300 LOC | branch/PR with passing checks | surfaces, checks, repo access | fail closed |
| Advanced Loops | 300+ LOC | scheduled optimization, holdout gates, matrix runs | eval adapter, budgets, gates | explicit opt-in |

If a product has no checks, it is not eligible for PR mode. If a product has no traces, it is not eligible for credible recommendations. If a product has neither, start at Observe.

## Ideal API

### Observe

```ts
import { createIntelligenceClient } from '@tangle-network/agent-runtime/intelligence'

const intelligence = createIntelligenceClient({
  project: 'support-agent',
  apiKey: process.env.TANGLE_API_KEY,
})

export async function runAgent(input: UserInput) {
  return intelligence.traceRun({ input }, async (trace) => {
    const result = await myAgent(input)
    trace.recordOutput(result)
    return result
  })
}
```

This mode must swallow telemetry export failures. Live chat cannot fail because Intelligence is unavailable.

### Recommend

```ts
const intelligence = createIntelligenceClient({
  project: 'support-agent',
  apiKey: process.env.TANGLE_API_KEY,
  outcomes: {
    fromRun: (run) => ({
      success: run.resolved,
      score: run.csat ?? run.evalScore,
      costUsd: run.costUsd,
    }),
  },
})

await intelligence.flushRecommendations()
```

Recommendation mode is allowed to create reports, issues, dashboard cards, or local artifacts. It is not allowed to change code.

### Verified PRs

```ts
const intelligence = createIntelligenceClient({
  project: 'support-agent',
  apiKey: process.env.TANGLE_API_KEY,
  repo: { owner: 'acme', name: 'support-agent', baseBranch: 'main' },
  surfaces: ['src/agent/prompt.ts', 'src/tools/**/*.ts'],
  checks: ['pnpm test', 'pnpm typecheck'],
  mode: 'open-pr',
})

await intelligence.runImprovementCycle()
```

PR mode must run in an isolated branch or worktree. Deterministic failures, build failures, missing credentials, verifier failures, and check failures block PR creation.

### Advanced Loops

```ts
await intelligence.configureLoop({
  budgetUsd: 25,
  candidates: 4,
  gate: {
    kind: 'paired-bootstrap',
    minLift: 0.03,
    maxRegressionRisk: 0.05,
  },
  matrix: {
    profiles: ['baseline', 'tool-heavy'],
    personas: ['legal-ops', 'associate'],
  },
})
```

Advanced mode exposes the deeper machinery: `runLoop`, strategy evolution, analyst loops, held-out gates, delegation, knowledge writeback, and matrix evals. It should be impossible to stumble into this complexity during first adoption.

## Implementation Shape In This Repo

The product SDK should be a thin layer over shipped primitives:

| SDK Concept | Existing Primitive |
|---|---|
| trace export | `createOtelExporter`, `loopEventToOtelSpan` |
| eval provenance export | `exportEvalRuns` |
| production chat envelope | `handleChatTurn` |
| manifest and mutable surfaces | `defineAgent` |
| trace-to-finding loop | `runAnalystLoop` |
| code/tool/MCP candidate generation | `improvementDriver`, `agenticGenerator`, verifiers |
| loop execution | `runLoop`, `createRefineDriver`, `createFanoutVoteDriver`, `createDriver` |
| promotion | `promotionGate`, held-out gates in `@tangle-network/agent-eval` |

The wrapper should live behind a new subpath such as:

```ts
import {
  createIntelligenceClient,
  withTangleIntelligence,
  defineImprovementSurface,
} from '@tangle-network/agent-runtime/intelligence'
```

The wrapper owns defaults and ergonomics. The substrate keeps owning traces, loops, gates, and candidate verification.

## Product Agents

For product agents, the integration target is the production entrypoint:

- HTTP route or worker handler.
- Chat function.
- Agent framework run method.
- CLI command.
- MCP server handler.

Do not instrument a parallel demo path and call it done. The trace must represent real user-facing behavior.

Minimum data per run:

- project id, run id, trace id, commit sha if available.
- model, provider, config hash.
- input/output token usage and cost if available.
- tool calls and errors.
- outcome or score if available.
- artifacts or pointers, not raw secrets.

## Loops

For loops, the product API should not expose a second loop grammar. It should configure existing runtime drivers:

- `sample` / best-of-N.
- `refine`.
- fanout-vote.
- dynamic driver.
- code/tool/MCP generation through `agenticGenerator`.

The SDK should record loop topology, budget, candidate ids, verifier results, and promotion decisions into Intelligence. The loop output is not trustworthy without the trace and gate artifact.

## Evals

For evals, the product API should make the real product path evaluable:

- Import the production agent/profile/composer.
- Run scenarios through the same entrypoint.
- Export eval runs with `exportEvalRuns`.
- Keep selector and judge separated.
- Treat deterministic failures as hard blockers.

The customer should be able to add one eval file later, not before first value.

## Fail-Closed Rules

- No checks: no PR mode.
- No mutable surfaces: no generated code/prompt changes.
- No traces: no recommendations.
- No held-out gate: no "improved" claim.
- No real backend: no benchmark/eval claim.
- Telemetry unavailable: do not break production.

## Done State

The SDK is shippable when a new product can do this in one sitting:

1. Add the package.
2. Wrap the agent.
3. Run one live turn.
4. See the trace in Intelligence.
5. Receive a recommendation from real trace data.
6. Add checks/surfaces.
7. Receive a verified PR that passes those checks.

The advanced stack remains available, but the first mile must be boring.
