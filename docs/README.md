# agent-runtime — documentation index

The map of every doc in this repo and the order to read them. Two tracks: **Architecture** (what the system is and where it's going) and **Reference** (how to use the package). On any *architecture* conflict, [`architecture.md`](./architecture.md) wins — the other architecture docs are either its deep-dives or are being consolidated into it.

## Architecture track

Read top-to-bottom for the full picture.

| # | Doc | Role | Purpose |
|---|---|---|---|
| 1 | [architecture.md](./architecture.md) | **canonical spine** | One recursive agent-loop, two timescales, many benchmarks. The single source of truth; wins on conflict. |
| 2 | [architecture-interpretations.md](./architecture-interpretations.md) | coherence verdict | Stress-tests the spine through five lenses (test-time-compute, active learning, program synthesis, two-timescale RSI, skeptic) + diagrams. Answers "does it cohere?" — and where it doesn't. |
| 3 | [roadmap-rsi.md](./roadmap-rsi.md) | build + cleanup plan | The file-grounded, dependency-ordered sequence to go from *scaffold built, intelligence designed* to a measured surface. Phases, exit gates, cruft track, doc track, open decisions. |
| 4 | [learning-flywheel.md](./learning-flywheel.md) | theory deep-dive | The moat thesis — the `(π, τ, J, D, O)` recursion and cross-run flywheel. Points to `architecture.md` as the canonical entry. |
| 5 | [../bench/README.md](../bench/README.md) | empirical harness | The benchmark surface and current empirical status (what's been run, what wins, what's untested). |

## Research track

Forward-looking design research — surveys, multi-agent design passes, decision logs. Not the canonical spine; promotions into `architecture.md` happen explicitly once a design ships.

| Doc | Role | Purpose |
|---|---|---|
| [research/README.md](./research/README.md) | research index | The active design thread + decision log + source-artifact pointers. |
| [research/recursive-execution-atom.md](./research/recursive-execution-atom.md) | design (in progress) | The next generation: one recursive `Agent` atom run as a durable, observable supervision tree (drivers-of-drivers, analyst-as-agent-with-runtime, async dynamic spawning). Plane B — contains the flat harness. |
| [research/flat-harness-design.md](./research/flat-harness-design.md) | design synthesis | Plane A — the assumption-free experiment harness (profiles × steer × executionMode × allocation). Recovered as the simplest `act` body on Plane B. |
| [research/long-horizon-benchmark-survey.md](./research/long-horizon-benchmark-survey.md) | survey | Adversarially-verified long-horizon + multi-turn benchmark survey. Top picks: Commit0, τ²-bench. |

## Reference track

The package API and subsystems.

| Doc | Role | Purpose |
|---|---|---|
| [../README.md](../README.md) | API entry point | Install, the loop API, self-improvement framing, exported subpaths. |
| [concepts.md](./concepts.md) | mental model | The layer cake — backends, profiles, loop kernel, the onramp to the rest. |
| [agent-bus-protocol.md](./agent-bus-protocol.md) | normative protocol *(needs-update)* | The multi-agent call bus — depth limits, headers, refusal contract. (Pending: 429/413 fix + subpath list.) |
| [conversation-economics.md](./conversation-economics.md) | subsystem | Conversation cost accounting and auth-source model (`src/conversation/`). |
| [durability-adapters.md](./durability-adapters.md) | subsystem | Journal + durability adapters for resumable conversations. |
| [refactor-roadmap.md](./refactor-roadmap.md) | package hygiene *(needs prune)* | Package-structure cleanup items (R1–R10); closed items deleted per its own rule. |

## Conventions

- Each doc declares its **track** and **role** (canonical / deep-dive / reference / needs-update) in a one-line header banner.
- Architecture docs cross-link the spine; the spine links its deep-dives and the empirical harness.
- "Built vs Designed" is stated explicitly in `architecture.md` and `architecture-interpretations.md` — never assume a documented design is shipped without the `file:line` anchor.
- Repo-wide authorship + comment-discipline + layering rules live in [../CLAUDE.md](../CLAUDE.md).
