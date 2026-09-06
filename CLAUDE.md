# agent-runtime

This package owns agent execution and composes evaluation and knowledge workflows.
Domain policy belongs in adapters and agent profiles.

## Read for the task

- Before implementation, read [BUILDING.md](docs/BUILDING.md) for build discipline and [ANTI_PATTERNS.md](docs/ANTI_PATTERNS.md) for known failure modes.
- Before changing orchestration, optimization, or measurement, read [canonical-api.md](docs/canonical-api.md) for the maintained API decision table.
  Author behavior through the complete agent profile: instructions, skills, tools, resources, subagents, and hooks.
  Use the existing execution and profile-materialization paths before adding a new loop or provider-specific configuration.
- Before architectural changes, read [architecture.md](docs/architecture.md) and [architecture-interpretations.md](docs/architecture-interpretations.md).
  For distributed coordination, provider workers, recovery, or run-API convergence, also read [agent-managed-compute](docs/agent-managed-compute/README.md).
- Before work under `bench/`, read [bench/HARNESS.md](bench/HARNESS.md).
- Before changing documentation or addressing freshness failures, read [MAINTAINING.md](docs/MAINTAINING.md).
  Generated API pages live under `docs/api/`; regenerate them through the package scripts.
- Use [docs/README.md](docs/README.md) to find other topic owners.

Check behavior against the implementation and relevant tests when a source conflicts.
Update the nearest maintained document when a change invalidates it.
Keep changing signatures, provider capabilities, and command inventories in their owning sources.

## Dependency boundaries

- `agent-interface` owns portable contracts.
- `agent-eval` owns evaluation data and decisions.
- `agent-knowledge` owns knowledge operations and does not depend on this runtime.
- This package composes those lower packages and owns concepts coupled to running execution.

Lower packages must not import runtime types or add runtime dependencies, including development and peer dependencies.
Move portable contracts to `agent-interface`, evaluation concepts to `agent-eval`, or inject execution through a callback.
Keep declared dependency ranges compatible with the APIs actually consumed.

## Experiments and retained knowledge

The product must improve decisions and learning methods across runs.
Before choosing experiments or deleting mechanisms, read architecture sections 0.5 and 9 for success criteria and experiment scope.
A single-run comparison tests a specific mechanism; it does not establish learning across projects.
Report which part of the agent changed, the measured effect on fresh tasks, and the comparison's limits.

When present, inspect `.evolve/current.json` and the `memory/` evidence ledger before resuming an experiment.
These are local run records, not required files in a fresh clone.
Retain result artifacts, observation context, and commands needed to reproduce claims.
Resolve conflicting notes against their underlying evidence.
Keep run status and measurements in those records rather than this entrypoint.

## Local conventions

Use the repository's package scripts for checks and build commands.
For changes to published code, run the package verification path; a source build alone does not prove the packed artifact.
Comments explain current behavior and reasons; change history belongs in commits and pull requests.
Do not add AI-attribution trailers to commits or artifacts.
External-boundary calls return typed outcomes with explicit success or failure and diagnostic information.
Inspect `succeeded` before using `value`; fallback policies must be explicit.
