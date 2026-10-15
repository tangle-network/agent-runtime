# agent-runtime

This package owns agent execution and composes evaluation and knowledge workflows.
Domain policy belongs in adapters and agent profiles.

## Delivery

Work on a feature branch, run relevant checks while developing, and report actual results. Push the branch and land the exact intended head in `main`. Source integration does not require a green CI run, local signoff, a version bump, published dependencies, or a queue label. A draft or explicit hold is not permission to merge. Post-merge CI is a safety net, not a condition for finishing a source-only task.

The shared command is `tangle-ops merge` after the companion tooling change is installed. Until then, use the ordinary GitHub merge endpoint with the exact expected head SHA. Native restrictions still apply; never forge statuses, remove a hold or use an administrator bypass. Removing obsolete required-check settings is a separate administrator rollout.

Release qualification and package publication remain separate, explicitly authorized operations. The existing publishing workflow owns tag/source identity, packed artifacts, cohort compatibility, credential isolation and publication. Do not dispatch publication or alter release controls to finish a source task. A merge is not a package release or a production result.

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

When present, inspect `.evolve/current.json` and the `memory/` evidence ledger before resuming an experiment.
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
