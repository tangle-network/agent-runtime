# Building

Extend existing profiles, providers, and policies before adding another abstraction.

## Before Editing

1. Read [`canonical-api.md`](./canonical-api.md) and search the public exports.
2. Name the application flow that needs to change.
3. Identify which package owns the concept.
4. Run the smallest executable case that exposes the current behavior.

## Ownership

- Portable profile or environment contracts belong in Agent Interface.
- Evaluation cases, outcomes, traces, comparisons, and optimizer contracts belong in Agent Eval.
- Sources, indexes, retrieval, memory, and knowledge checks belong in Agent Knowledge.
- Execution flow, environment lifecycle, coordination, and agent-driven composition belong in Runtime.
- Authentication, billing, product policy, and UI belong in applications.

Do not create an upward dependency from a lower package to Runtime.

## Implementation Rules

- Pass an `AgentEnvironmentProvider` into Runtime instead of branching on vendor names.
- Advertise only capabilities the provider implements.
- Keep environment ownership explicit and close owned resources in `finally` blocks.
- Preserve provider events, errors, session IDs, and usage data.
- Use stable run and command IDs for retryable work.
- Keep proposal, evaluation, and activation as separate operations.
- Delete a replaced API and migrate first-party callers in the same change.
- Add a new control policy only when existing composition cannot express the behavior cleanly.

## Proof

Run focused tests while editing, then run the package checks before pushing:

```bash
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm run verify:package
pnpm run docs:check
```

Run `pnpm run verify:bench` when changing shared execution, candidate execution, or public types used by `@tangle-network/agent-bench`.

Live provider behavior requires a provider integration run in addition to local tests.
Record the provider, model, cases, resource limits, cost, duration, and failures for comparisons.
