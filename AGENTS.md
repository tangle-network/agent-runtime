# agent-runtime

This package owns agent execution and composes evaluation and knowledge workflows.
Domain policy belongs in adapters and agent profiles.

## Map

Every public subpath is an entry in [package.json](package.json) `exports`; [tsdown.config.ts](tsdown.config.ts) names the source file behind each.
The `.` entry is [src/index.ts](src/index.ts); the `./kernel` entry is [src/runtime/index.ts](src/runtime/index.ts).

| Path | Owns | Verify |
|---|---|---|
| [src/runtime/](src/runtime/) | Execution kernel: supervisor, scopes, budgets, executors, graphs (`supervise/`), personify combinators | `pnpm run typecheck`, then `pnpm test <path>` |
| [src/improvement/](src/improvement/), [src/intelligence/](src/intelligence/), [src/candidate-execution/](src/candidate-execution/), [src/analyst-loop/](src/analyst-loop/), [src/knowledge/](src/knowledge/) | Improvement entry `improve()`, trace capture and reviewable proposals, sealed candidate lifecycle, analyst loop, knowledge improvement jobs | same |
| [src/agent/](src/agent/), [src/profiles/](src/profiles/), [src/conversation/](src/conversation/), [src/durable/](src/durable/), [src/workspace-store/](src/workspace-store/) | `defineAgent` manifest, authored profile presets, multi-agent conversation, chat-turn envelope and run-directory records, per-tenant workspace store | same |
| [src/mcp/](src/mcp/), [src/platform/](src/platform/), [src/placement/](src/placement/), [src/pricing/](src/pricing/), [src/tui/](src/tui/), [src/testing/](src/testing/) | Delegation MCP server and coordination tools, platform clients, executor placement, generated router prices, terminal view, offline fixtures | same |
| [tests/](tests/) | Integration and conformance tests; shared helpers in [tests/helpers/](tests/helpers/), the scripted driver brain in [tests/kernel/scripted-brain.ts](tests/kernel/scripted-brain.ts) | `pnpm test <path>` |
| [examples/](examples/) | Runnable public-API examples (see [examples/README.md](examples/README.md)); compile through `tsconfig.examples.json` | `pnpm run typecheck` |
| [bench/](bench/) | Separate package `@tangle-network/agent-bench`: benchmark adapters and harness; read [bench/HARNESS.md](bench/HARNESS.md) first | `pnpm run verify:bench` |
| [skills/](skills/) | Skills shipped with the package | `pnpm run check:skills` |
| [docs/](docs/) | Judgment docs by hand, generated reference in `docs/api/`; index in [docs/README.md](docs/README.md); dated history in `docs/archive/` | `pnpm run docs:check` |
| [scripts/](scripts/), [release/](release/), [conformance/](conformance/) | Release, cohort, publish and conformance tooling and data | `pnpm run verify:package` |

Leaf helpers shared across the package live at the `src/` root ([errors.ts](src/errors.ts), [record-value.ts](src/record-value.ts), [finite-number.ts](src/finite-number.ts), [redact.ts](src/redact.ts), [sanitize.ts](src/sanitize.ts)) and in [src/runtime/util.ts](src/runtime/util.ts) for kernel internals.
Before adding a helper, `git grep` for its name and job there; a duplicate export name is a defect.
The package scripts in [package.json](package.json) are the only command inventory; this file names the one that verifies each area.

## Delivery

Work on a feature branch and run relevant checks while developing. Land authorized PRs into `main` with `gh pr merge <PR> --merge --match-head-commit <INTENDED_HEAD_SHA>`. Capture the intended head first; read back `mergedAt` and `mergeCommit` before reporting a completed merge. No additional merge wrapper or host installation is required.

A PR that changes Runtime source or its published manifest adds one `.release-notes/<slug>.md` ([format](.release-notes/README.md)); `release:prepare` builds the version and changelog only from those notes, so a merged change without one is never released.

Ordinary internal source PRs do not wait for CI, local signoff, a version bump or package publication. Release PRs and external contributions retain verification. Drafts, explicit holds, conflicts and native repository restrictions still apply; do not use an administrator bypass or fabricate passing checks. A skipped job is not test evidence.

Publication is a separate authorized operation. The existing publisher qualifies the frozen tagged revision and exact package artifacts, including cohort compatibility and credential isolation. Advancing main does not retarget that candidate. A source merge is neither a package release nor a production result.

## Read for the task

- Before implementation, read [BUILDING.md](docs/BUILDING.md) for build discipline and [ANTI_PATTERNS.md](docs/ANTI_PATTERNS.md) for known failure modes.
- Before changing orchestration, optimization, or measurement, read [canonical-api.md](docs/canonical-api.md) for the maintained API decision table.
  Author behavior through the complete agent profile: instructions, skills, tools, resources, subagents, and hooks.
  Use the existing execution and profile-materialization paths before adding a new loop or provider-specific configuration.
- Before architectural changes, read [architecture.md](docs/architecture.md) and [architecture-interpretations.md](docs/architecture-interpretations.md).
  For distributed coordination, provider workers, recovery, or run-API convergence, also read [agent-managed-compute](docs/agent-managed-compute/README.md).
- Before work under `bench/`, read [bench/HARNESS.md](bench/HARNESS.md) for its repository-ownership table.
- Before changing documentation or addressing freshness failures, read [MAINTAINING.md](docs/MAINTAINING.md).
  Generated API pages live under `docs/api/`; regenerate them through the package scripts.
- Use [docs/README.md](docs/README.md) to find other topic owners.

These gates bind when you name a destination, not only when you edit a file.
Recommending, planning, or scoping work into a location commits the cost, so read that location's owning document first.
Do not propose a directory or repository for new work before reading the document that says what it holds.

Check behavior against the implementation and relevant tests when a source conflicts.
Update the nearest maintained document when a change invalidates it.
Keep changing signatures, provider capabilities, and command inventories in their owning sources.

## Dependency boundaries

- `agent-interface` owns portable contracts.
- `agent-eval` owns evaluation data and decisions.
- `agent-knowledge` owns knowledge operations and does not depend on this runtime.
- This package composes those lower packages and owns concepts coupled to running execution.

Consumers own the campaigns that use this runtime.
This package holds exact execution, reusable benchmark adapters, and packed-consumer checks.
It does not hold experiment generations, hill climbs, or campaigns asking whether a method improves a benchmark.
Those belong in the consuming lab repository; [bench/HARNESS.md](bench/HARNESS.md) holds the ownership table and the evidence levels.

Lower packages must not import runtime types or add runtime dependencies, including development and peer dependencies.
Move portable contracts to `agent-interface`, evaluation concepts to `agent-eval`, or inject execution through a callback.
Keep declared dependency ranges compatible with the APIs actually consumed.

## Experiments and retained knowledge

The product must improve decisions and learning methods across runs.
Before choosing experiments or deleting mechanisms, read architecture sections 0.5 and 9 for success criteria and experiment scope.
A single-run comparison tests a specific mechanism; it does not establish learning across projects.
Report which part of the agent changed, the measured effect on fresh tasks, and the comparison's limits.

When present, inspect the untracked `.evolve` run record and the `memory/` evidence ledger before resuming an experiment.
These are local run records, not required files in a fresh clone.
Retain result artifacts, observation context, and commands needed to reproduce claims.
Resolve conflicting notes against their underlying evidence.
Keep run status and measurements in those records rather than this entrypoint.

## Local conventions

Use the repository's package scripts for checks and build commands.
Run relevant checks while developing. Package verification is required at publication, not as a source-merge prerequisite; a source build alone does not prove the packed artifact.
Comments explain current behavior and reasons; change history belongs in commits and pull requests.
Do not add AI-attribution trailers to commits or artifacts.
External-boundary calls return typed outcomes with explicit success or failure and diagnostic information.
Inspect `succeeded` before using `value`; fallback policies must be explicit.
