# agent-runtime refactor roadmap

Synthesis of accumulated audit findings into a prioritized refactor plan.
Authored 2026-05-27 after the substrate↔runtime layering fix in
agent-eval 0.48.0 + agent-runtime 0.26.0 that eliminated the
`@tangle-network/agent-runtime → @tangle-network/agent-eval`-inversion
imports (`DefaultVerdict` and `RunRecord` both moved DOWN to agent-eval).

This doc replaces the open audit-task TODO; it does not replace the
[CLAUDE.md repo-layering rule](../CLAUDE.md#repo-layering--this-package-depends-on-agent-eval-never-the-reverse) which is now load-bearing.

## What's working

The runtime substrate has matured into a real product across `gtm`,
`creative`, `legal`, `tax`, `agent-builder`, `physim`. Strengths to
preserve through any refactor:

- **`handleChatTurn`** is the genuine production centerpiece — six
  consumer products lean on it; that surface should stay stable.
- **`runLoop` + `Driver` + `Validator`** is the multi-shot kernel and
  has clean separation from substrate concerns (after the inversion fix).
- **`/mcp` server + executor + worktrees** delivers genuine in-sandbox
  delegation; the recent `child_process + worktrees + local harness CLIs`
  work landed cleanly.
- **OTEL export** is opt-in, no surprises.
- **`sanitize.ts`** + redaction is well-isolated.
- **`/agent` (`defineAgent`)** keeps domain agents declarative without
  pulling product code into the runtime.

## What needs work — ordered by leverage

### Tier 1 — Structural debt that compounds

**R1. Consolidate `/improvement` and `/analyst-loop` under one umbrella.**

Both surfaces wrap agent-eval primitives (`runImprovementLoop` from
agent-eval/campaign, plus the analyst registry from agent-eval). The
two subpaths use different conventions (`improvement-driver` vs
`run-analyst-loop`) and have overlapping concerns around findings →
mutation → gate. Pick one shape, deprecate the other in a 0.27 minor
with re-exports for backward compat.

The bias: keep the surface that consumer products actually call from
their `production-runner.ts` files. Reading the 6 product repos, that's
`runImprovementLoop` from agent-eval/contract + `runAnalystLoop` from
agent-runtime/analyst-loop. The `/improvement` entry duplicates pieces
of both — likely a candidate for collapse.

Estimate: 4-6h. Owner: claude. Surfaces touched: `/improvement`, no
runtime behavior change required if collapse is purely re-exports.

**R2. `runtime-run.ts` is doing four jobs.**

Persistence + cost ledger + handle lifecycle + cross-process resume.
Each is legitimate; together they make this file the single biggest
"reach for the right method" footgun in the package. Split into:

- `runtime-run/handle.ts` — `RuntimeRunHandle` lifecycle
- `runtime-run/persistence.ts` — durable record + restore
- `runtime-run/cost-ledger.ts` — cost aggregation
- `runtime-run/resume.ts` — `deriveExecutionId` + cross-process

Keep `runtime-run.ts` as the barrel re-export. No surface change for
consumers; internal navigation improves dramatically.

Estimate: 3-4h. Risk: low — internal-only.

**R3. Drop `analyst-loop/types.ts` re-imports from agent-eval.**

`src/analyst-loop/types.ts` re-exports `AnalystFinding`, `AnalystRunResult`,
`FindingsDiff` from agent-eval. These re-exports made sense when
agent-runtime was the single point of integration; now that 6 consumers
import directly from agent-eval, the re-exports are dead weight that
hide where types come from. Drop them; consumers update to import from
agent-eval directly.

Estimate: 2h + 1h coordination per consumer (6 consumers = 6h
distributed, can be batched in one PR per consumer with a single
agent-runtime 0.27 release).

### Tier 2 — Surface cleanup

**R4. The `loops/drivers/` folder mixes shipped + experimental.**

`refine.ts` and `fanout-vote.ts` are shipped and consumed by
`coderProfile()` + agent-builder. The `/loops` entry exports both. Both
are `@experimental`-marked in the source but products depend on them.
Decision needed:

- Drop `@experimental` markers on these two specifically (they're load-bearing)
- Add stability tier in the README's "Which entry point" table
- Document the experimental-vs-stable line clearly

Estimate: 1h.

**R5. `/profiles` has one file (`coder.ts`).**

Single-file subpath. Either fold into `/agent` (defineAgent uses the
same pattern) or add the planned `researcherProfile` / `analystProfile`
sibling profiles. The current state is awkward — consumers don't know
whether profiles are a real concept or a temporary home.

Recommendation: build out `researcherProfile` (already on Drew's
pending list per task #36) and ship as `0.27.x` minor. Then `/profiles`
becomes a documented stable entry.

Estimate: 4-6h to land researcherProfile cleanly.

**R6. `examples/` directory has 14 directories, only ~6 referenced from README.**

The unreferenced ones bit-rot. Either reference them all from a
"complete examples index" or delete the ones no longer needed. Pick
one per consumer pattern (chat-handler, knowledge-readiness, sanitized-telemetry,
coder-loop, researcher-loop, mcp-fleet, distributed-driver) and archive
the rest under `examples/archive/`.

Estimate: 2h.

### Tier 3 — Hygiene

**R7. Test files mix locations.**

`src/model-resolution.test.ts` lives in `src/`; everything else in
`tests/`. Move to `tests/model-resolution.test.ts` for consistency.

Estimate: 30min.

**R8. `loops/trace.ts` and `loops/types.ts` overlap.**

Trace event payload types appear in both. Consolidate into one file;
re-export from the other for backward compat.

Estimate: 1-2h.

**R9. `src/durable/` has one engine + one handle + one tests dir.**

Tests live under `src/durable/tests/` while every other test lives
under `tests/`. Move durable tests up to `tests/durable/` for parity.

Estimate: 30min.

**R10. Backends folder has both `backends.ts` (single file) and
`src/backends/` (directory).**

Confusing duality. Resolve by either folding `backends.ts` into
`backends/index.ts`, or move backend-related code OUT of `backends.ts`
into appropriately-named files inside `backends/`.

Estimate: 1h.

## Sequencing recommendation

**Week 1 — high-leverage debt:**
1. R3 (drop dead re-exports) — unblocks Tier 2 understanding
2. R1 (consolidate /improvement) — clarifies the actual "primary surface"
3. R2 (split runtime-run) — internal navigation win

**Week 2 — surface clarity:**
4. R4 (stability markers on shipped drivers)
5. R5 (researcherProfile if pursuing it)
6. R6 (examples cleanup)

**Bundled hygiene PR (anytime):**
7. R7 + R8 + R9 + R10 — pure cleanup, no semantic change

## Non-goals (do NOT do these)

- **Do NOT rename anything in the public surface** without an explicit
  major bump + consumer migration PRs. The 6 consumer products are not
  trivially migratable; surface stability matters more than perfect
  naming.
- **Do NOT add new entry points** without first questioning whether the
  feature belongs in agent-eval (substrate) instead. See CLAUDE.md
  "Repo layering" — the test is "does this make sense WITHOUT a running
  agent loop?"
- **Do NOT add direct dependencies on consumer packages** (`agent-builder`,
  `gtm`, etc.) into agent-runtime. agent-runtime sits between the
  substrate and the consumers; pulling consumer concepts up creates a
  new inversion class.
- **Do NOT introduce a new optional peer dep on agent-eval.** The
  current `dependencies: { "@tangle-network/agent-eval": "^0.48.0" }`
  is correct. Moving to a peer dep would break workspace installs.

## How to use this doc

When a refactor PR touches agent-runtime, reference the relevant `Rn`
item from this list (or add a new one with the same shape and put it
into Tier ordering by leverage). Close items by deleting their entry
in this doc when the work ships; PR description carries the historical
narrative — this file stays a forward-looking roadmap.

When the roadmap reaches zero items, archive it under
`docs/archive/refactor-roadmap-YYYY-MM-DD.md` and start a fresh one.
