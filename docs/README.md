# agent-runtime — documentation index

The map of every doc. **Start here** if you're new; the deeper tracks follow.

## Start here

1. [The README](../README.md) — what the package is + the three things you do with it.
2. [concepts.md](./concepts.md) — the mental model (chat turns, tasks, runs) in plain terms.
3. [canonical-api.md](./canonical-api.md) — find the right primitive: "I want to ___ → use ___".
4. [../examples/](../examples) — copy a runnable example near your task.

**Building something specific?** Go straight to [canonical-api.md](./canonical-api.md) and the matching example. **Going deep on the design?** The Architecture track below — on any architecture conflict, [`architecture.md`](./architecture.md) wins.

## Architecture track

| # | Doc | Role | Purpose |
|---|---|---|---|
| 1 | [architecture.md](./architecture.md) | **canonical spine** | One recursive agent tree, two timescales, many benchmarks — the visual mental model (`act`/`Scope`/recursion, the up-flow, the three improvement timescales) folded in. The single source of truth; wins on conflict. |
| 2 | [architecture-interpretations.md](./architecture-interpretations.md) | coherence verdict | Stress-tests the spine through five lenses + the decision gate. Answers "does it cohere?" — and where it doesn't. |
| 3 | [roadmap-rsi.md](./roadmap-rsi.md) | build plan | The dependency-ordered sequence from scaffold to a measured surface. Phases, exit gates, open decisions. |
| 4 | [learning-flywheel.md](./learning-flywheel.md) | theory deep-dive | The moat thesis — the `(π, τ, J, D, O)` recursion and cross-run flywheel. |
| 5 | [eval-substrate.md](./eval-substrate.md) | north star + discipline | The neutral measurement substrate, the data engine, and the measurement non-negotiables. |
| 6 | [../bench/HARNESS.md](../bench/HARNESS.md) | empirical harness map | Commands, the data flow, the wired/needs-creds matrix, the canonical-suite runbook. |

## Reference track

| Doc | Role | Purpose |
|---|---|---|
| [../README.md](../README.md) | API entry point | Install, the loop API, the plain-language framing, the exported subpaths. Start HERE. |
| [canonical-api.md](./canonical-api.md) | API spine + decision table | The conceptual spine + the "I want to ___ → use ___" anti-reinvention matrix of LOCAL symbols. Per-symbol signatures are generated into [api/](./api/). |
| [concepts.md](./concepts.md) | mental model | The product-API layer cake (chat turns, tasks, runs) — the onramp before the loop/strategy docs. |
| [glossary.md](./glossary.md) | canonical vocabulary | One definition per term, grounded to `file:line`; drifted synonyms flagged. |
| [execution-model.md](./execution-model.md) | the picture | The unified `Executor` port (router/bridge/cli/sandbox/BYO) + two engines, driver vs worker, spawn mechanics. |
| [agent-bus-protocol.md](./agent-bus-protocol.md) | normative protocol | The multi-agent call bus — depth limits, headers, refusal contract. |
| [durability-adapters.md](./durability-adapters.md) | subsystem | Journal + durability for resumable conversations + supervisor trees. |
| [intelligence-sdk.md](./intelligence-sdk.md) | subsystem | The product intelligence drop-in (`withTangleIntelligence`). |
| [BUILDING.md](./BUILDING.md) | process | Building discipline: goal first, cheapest decisive proof, verification rules. |
| [ANTI_PATTERNS.md](./ANTI_PATTERNS.md) | process | Named failure modes. |
| [MAINTAINING.md](./MAINTAINING.md) | process | How the generated API reference + the docs-freshness gate stay honest. |

## Active work + research

| Doc | Role | Purpose |
|---|---|---|
| [simplification-plan.md](./research/simplification-plan.md) | **live tracker** | The in-flight simplification/rearchitecture: the converged design, the scratch list, the doc/module inventory, the workstreams + completion criteria. |
| [research/README.md](./research/README.md) | research index | Forward-looking design threads + decision log. Not the canonical spine. |
| [archive/](./archive/) | retired notes | Superseded/niche docs kept for history (delivery manifest, conversation economics, artifact-lifecycle, go-live, results). |

## Conventions

- On any architecture conflict, `architecture.md` wins; "Built vs Designed" is stated explicitly with a `file:line` anchor — never assume a documented design is shipped without one.
- The generated [api/](./api/) reference + the docs-freshness gate (`scripts/check-docs-freshness.mjs`) keep the curated docs honest: every backticked symbol must resolve. See [MAINTAINING.md](./MAINTAINING.md).
- Repo bootloader + authorship/comment/layering deltas live in [../CLAUDE.md](../CLAUDE.md).
