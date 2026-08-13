# agent-runtime — documentation index

The map of every doc. **Start here** if you're new; the deeper tracks follow.

## Start here

1. [The README](../README.md) — what the package is, a runnable offline quickstart, and the primitives catalog.
2. [concepts.md](./concepts.md) — the mental model (chat turns, tasks, runs) in plain terms.
3. [canonical-api.md](./canonical-api.md) — find the right primitive: "I want to ___ → use ___".
4. [../examples/](../examples) — copy a runnable example near your task.

**Building something specific?** Go straight to [canonical-api.md](./canonical-api.md) and the matching example — that's all you need to *use* the package. The tracks below are for **understanding or extending the internals** (design, RSI research, benchmark harness); skip them if you're just building.

## Architecture & research track — *not required to use the package*

These are internal working documents: design theses, research narrative, and roadmap bookkeeping for the team building the package. [design.md](./design.md) is the plain-terms front door to all of them.

| # | Doc | Role | Purpose |
|---|---|---|---|
| 0 | [design.md](./design.md) | **front door** | The design philosophy in plain terms + the map of the internal docs below. Start here for background. |
| 1 | [architecture.md](./architecture.md) | **canonical spine** | One recursive agent tree, two timescales, many benchmarks — the visual mental model (`act`/`Scope`/recursion, the up-flow, the three improvement timescales) folded in. The single source of truth; wins on conflict. |
| 1a | [agent-managed-compute/](./agent-managed-compute/) | **distributed execution plan** | Current-state audit, converged design, failure behavior, dependency-ordered roadmap, and measurable completion criteria for agents that allocate and steer compute. |
| 2 | [architecture-interpretations.md](./architecture-interpretations.md) | coherence verdict | Stress-tests the spine through five lenses + the decision gate. Answers "does it cohere?" — and where it doesn't. |
| 3 | [roadmap-rsi.md](./roadmap-rsi.md) | build plan | The dependency-ordered sequence from scaffold to a measured surface. Phases, exit gates, open decisions. |
| 4 | [learning-flywheel.md](./learning-flywheel.md) | theory deep-dive | The cross-run learning thesis: why the outer improvement loop, not any single run, is the product. |
| 5 | [eval-substrate.md](./eval-substrate.md) | measurement principles | Neutral scoring, honest graders, and the claims discipline the team holds itself to. |
| 6 | [../bench/HARNESS.md](../bench/HARNESS.md) | empirical harness map | Commands, the data flow, the wired/needs-creds matrix, the canonical-suite runbook. |

## Reference track

| Doc | Role | Purpose |
|---|---|---|
| [../README.md](../README.md) | API entry point | Install, the loop API, the plain-language framing, the exported subpaths. Start HERE. |
| [canonical-api.md](./canonical-api.md) | API spine + decision table | The conceptual spine + the "I want to ___ → use ___" anti-reinvention matrix of LOCAL symbols. Per-symbol signatures are generated into [api/](./api/). |
| [STABILITY.md](./STABILITY.md) | stability contract | What `@stable` / `@experimental` promise consumers, the graduation bar, and the demotion/removal policy. |
| [concepts.md](./concepts.md) | mental model | The product-API layer cake (chat turns, tasks, runs) — the onramp before the loop/strategy docs. |
| [glossary.md](./glossary.md) | canonical vocabulary | One definition per term, grounded to `file:line`; drifted synonyms flagged. |
| [execution-model.md](./execution-model.md) | the picture | The unified `Executor` port (router/bridge/cli/sandbox/BYO) + two engines, driver vs worker, spawn mechanics. |
| [agent-bus-protocol.md](./agent-bus-protocol.md) | normative protocol | The multi-agent call bus — depth limits, headers, refusal contract. |
| [durability-adapters.md](./durability-adapters.md) | subsystem | SQL-backed journal and restart behavior for conversations. Supervised-tree recovery is not implemented. |
| [intelligence-sdk.md](./intelligence-sdk.md) | product SDK | Observe + OFF billing floor + effort tiers + certified delivery + capability resolver — the `/intelligence` subpath. Designed-not-shipped verbs fenced at the tail. |
| [BUILDING.md](./BUILDING.md) | process | Building discipline: goal first, cheapest decisive proof, verification rules. |
| [ANTI_PATTERNS.md](./ANTI_PATTERNS.md) | process | Named failure modes. |
| [MAINTAINING.md](./MAINTAINING.md) | process | How the generated API reference + the docs-freshness gate stay honest. |

## Active work + research

| Doc | Role | Purpose |
|---|---|---|
| [design/prime-agent-harness-integration.md](./design/prime-agent-harness-integration.md) | integration contract | Prime Agent as a sandbox-materialized harness: the boundary, the anti-reinvention map, the substrate wish-list, and the first gated experiment. |
| [simplification-plan.md](./research/simplification-plan.md) | historical tracker | Earlier simplification analysis. The active execution and API convergence plan is [agent-managed-compute/roadmap.md](./agent-managed-compute/roadmap.md). |
| [research/README.md](./research/README.md) | research index | Forward-looking design threads + decision log. Not the canonical spine. |
| [archive/](./archive/) | retired notes | Superseded/niche docs kept for history (delivery manifest, conversation economics, artifact-lifecycle, go-live, results, benchmark-matrix consolidation). |

## Conventions

- On any architecture conflict, `architecture.md` wins; "Built vs Designed" is stated explicitly with a `file:line` anchor — never assume a documented design is shipped without one.
- The generated [api/](./api/) reference + the docs-freshness gate (`scripts/check-docs-freshness.mjs`) keep the curated docs honest: every backticked symbol must resolve. See [MAINTAINING.md](./MAINTAINING.md).
- Repo bootloader + authorship/comment/layering deltas live in [../CLAUDE.md](../CLAUDE.md).
